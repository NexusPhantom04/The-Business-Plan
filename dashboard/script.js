// dashboard/script.js
let trafficChart = null;

// Vérifier si déjà connecté au chargement
document.addEventListener('DOMContentLoaded', function() {
    checkAuth();
});

async function checkAuth() {
    try {
        const response = await fetch('/api/admin/check-auth');
        const data = await response.json();
        console.log('Auth check:', data);
        
        if (data.authenticated) {
            document.getElementById('loginPage').style.display = 'none';
            document.getElementById('dashboardPage').style.display = 'block';
            loadData('24h');
        } else {
            document.getElementById('loginPage').style.display = 'flex';
            document.getElementById('dashboardPage').style.display = 'none';
        }
    } catch (error) {
        console.error('❌ Erreur auth:', error);
        document.getElementById('loginPage').style.display = 'flex';
        document.getElementById('dashboardPage').style.display = 'none';
    }
}

async function login() {
    console.log('🔑 Tentative de connexion...');
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('loginError');
    
    if (!username || !password) {
        errorDiv.textContent = 'Veuillez remplir tous les champs';
        errorDiv.classList.remove('hidden');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        console.log('📥 Réponse login:', data);
        
        if (response.ok && data.success) {
            console.log('✅ Connexion réussie');
            errorDiv.classList.add('hidden');
            checkAuth();
        } else {
            errorDiv.textContent = data.error || 'Identifiants incorrects';
            errorDiv.classList.remove('hidden');
        }
    } catch (error) {
        console.error('❌ Erreur réseau:', error);
        errorDiv.textContent = 'Erreur de connexion au serveur';
        errorDiv.classList.remove('hidden');
    }
}

async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    checkAuth();
}

async function loadData(range = '24h') {
    // Mettre à jour les boutons actifs
    const buttons = document.querySelectorAll('.time-filter');
    buttons.forEach(btn => {
        btn.classList.remove('active', 'bg-yellow-600');
        btn.classList.add('bg-gray-700');
    });
    
    // Trouver et activer le bouton correspondant
    const activeBtn = Array.from(buttons).find(btn => {
        const text = btn.textContent.trim();
        if (range === '24h') return text === '24h';
        if (range === '7d') return text === '7 jours';
        if (range === '30d') return text === '30 jours';
        if (range === 'all') return text === 'Tout';
        return false;
    });
    
    if (activeBtn) {
        activeBtn.classList.add('active', 'bg-yellow-600');
        activeBtn.classList.remove('bg-gray-700');
    }
    
    // Charger toutes les données
    await Promise.all([
        loadOverview(range),
        loadCountries(),
        loadDevices(),
        loadBrowsers(),
        loadLatestVisits(),
        loadSales(),
        loadTrafficChart(range)
    ]);
}

async function loadOverview(range) {
    try {
        const response = await fetch(`/api/admin/stats/overview?range=${range}`);
        const data = await response.json();
        
        document.getElementById('totalVisits').textContent = data.totalVisits || 0;
        document.getElementById('uniqueVisitors').textContent = data.uniqueVisitors || 0;
        document.getElementById('totalSales').textContent = data.totalSales || 0;
        document.getElementById('totalRevenue').textContent = (data.totalRevenue || 0) + '€';
        document.getElementById('conversionRate').textContent = (data.conversionRate || 0) + '%';
        document.getElementById('lastUpdate').textContent = `Dernière mise à jour: ${new Date().toLocaleTimeString('fr-FR')}`;
    } catch (error) {
        console.error('Erreur overview:', error);
    }
}

async function loadCountries() {
    try {
        const response = await fetch('/api/admin/stats/countries');
        const countries = await response.json();
        
        if (!countries.length) {
            document.getElementById('countriesList').innerHTML = '<div class="text-gray-500">Aucune donnée</div>';
            return;
        }
        
        const html = countries.map(c => `
            <div class="flex justify-between items-center">
                <span>${c.country || 'Inconnu'}</span>
                <span class="text-yellow-500 font-bold">${c.count} vues</span>
            </div>
        `).join('');
        
        document.getElementById('countriesList').innerHTML = html;
    } catch (error) {
        console.error('Erreur pays:', error);
    }
}

async function loadDevices() {
    try {
        const response = await fetch('/api/admin/stats/devices');
        const devices = await response.json();
        
        if (!devices.length) {
            document.getElementById('devicesList').innerHTML = '<div class="text-gray-500">Aucune donnée</div>';
            return;
        }
        
        const html = devices.map(d => `
            <div class="flex justify-between items-center">
                <span>${d.device_type || 'Inconnu'}</span>
                <span class="text-yellow-500 font-bold">${d.count}</span>
            </div>
        `).join('');
        
        document.getElementById('devicesList').innerHTML = html;
    } catch (error) {
        console.error('Erreur appareils:', error);
    }
}

async function loadBrowsers() {
    try {
        const response = await fetch('/api/admin/stats/browsers');
        const browsers = await response.json();
        
        if (!browsers.length) {
            document.getElementById('browsersList').innerHTML = '<div class="text-gray-500">Aucune donnée</div>';
            return;
        }
        
        const html = browsers.map(b => `
            <div class="flex justify-between items-center">
                <span>${b.browser || 'Inconnu'}</span>
                <span class="text-yellow-500 font-bold">${b.count}</span>
            </div>
        `).join('');
        
        document.getElementById('browsersList').innerHTML = html;
    } catch (error) {
        console.error('Erreur navigateurs:', error);
    }
}

async function loadLatestVisits() {
    try {
        const response = await fetch('/api/admin/visits/latest');
        const visits = await response.json();
        
        if (!visits.length) {
            document.getElementById('latestVisits').innerHTML = '<tr><td colspan="6" class="text-center py-4">Aucune visite</td></tr>';
            return;
        }
        
        const html = visits.map(v => `
            <tr class="border-b border-white/5">
                <td class="py-2">${v.country || 'Inconnu'}</td>
                <td class="py-2">${v.city || 'Inconnu'}</td>
                <td class="py-2">${v.device_type || 'Inconnu'}</td>
                <td class="py-2">${v.browser || 'Inconnu'}</td>
                <td class="py-2">${v.page_visited || '/'}</td>
                <td class="py-2">${new Date(v.visit_time).toLocaleString('fr-FR')}</td>
            </tr>
        `).join('');
        
        document.getElementById('latestVisits').innerHTML = html;
    } catch (error) {
        console.error('Erreur visites:', error);
    }
}

async function loadSales() {
    try {
        const response = await fetch('/api/admin/sales/latest');
        const sales = await response.json();
        
        if (!sales.length) {
            document.getElementById('latestSales').innerHTML = '<tr><td colspan="5" class="text-center py-4">Aucune vente</td></tr>';
            return;
        }
        
        const html = sales.map(s => `
            <tr class="border-b border-white/5">
                <td class="py-2">${s.customer_name || 'Client'}</td>
                <td class="py-2">${s.customer_email}</td>
                <td class="py-2 text-yellow-500 font-bold">${s.amount}€</td>
                <td class="py-2">${new Date(s.created_at).toLocaleString('fr-FR')}</td>
                <td class="py-2">
                    <span class="px-2 py-1 rounded-full text-xs ${s.status === 'paid' ? 'bg-green-500/20 text-green-500' : 'bg-purple-500/20 text-purple-500'}">
                        ${s.status === 'paid' ? 'Payé' : 'Gratuit'}
                    </span>
                </td>
            </tr>
        `).join('');
        
        document.getElementById('latestSales').innerHTML = html;
    } catch (error) {
        console.error('Erreur ventes:', error);
    }
}

async function loadTrafficChart(range) {
    try {
        const response = await fetch(`/api/admin/stats/timeline?range=${range}`);
        const data = await response.json();
        
        const ctx = document.getElementById('trafficChart').getContext('2d');
        
        if (trafficChart) {
            trafficChart.destroy();
        }
        
        trafficChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => d.time_period),
                datasets: [{
                    label: 'Visites',
                    data: data.map(d => d.visits),
                    borderColor: '#D4AF37',
                    backgroundColor: 'rgba(212, 175, 55, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    } catch (error) {
        console.error('Erreur graphique:', error);
    }
}

// Fonction refresh pour le bouton
async function refreshData() {
    loadData(currentRange || '24h');
}

// Variable pour suivre le range actuel
let currentRange = '24h';

// Mettre à jour toutes les 30 secondes
setInterval(() => loadData(currentRange), 30000);
