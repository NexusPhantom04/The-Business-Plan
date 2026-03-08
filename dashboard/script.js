// dashboard/script.js
let trafficChart = null;
let currentRange = '24h';
let refreshInterval = null;

// État de chargement
let isLoading = false;

// Vérifier si déjà connecté au chargement
document.addEventListener('DOMContentLoaded', function() {
    checkAuth();
    
    // Ajouter un écouteur pour la touche Entrée sur les champs de login
    document.getElementById('username').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') login();
    });
    document.getElementById('password').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') login();
    });
});

async function checkAuth() {
    try {
        const response = await fetch('/api/admin/check-auth');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Auth check:', data);
        
        if (data.authenticated) {
            document.getElementById('loginPage').style.display = 'none';
            document.getElementById('dashboardPage').style.display = 'block';
            
            // Démarrer le rafraîchissement automatique
            if (refreshInterval) clearInterval(refreshInterval);
            refreshInterval = setInterval(() => loadData(currentRange), 30000);
            
            // Charger les données
            loadData(currentRange);
        } else {
            document.getElementById('loginPage').style.display = 'flex';
            document.getElementById('dashboardPage').style.display = 'none';
            
            // Nettoyer l'intervalle
            if (refreshInterval) {
                clearInterval(refreshInterval);
                refreshInterval = null;
            }
        }
    } catch (error) {
        console.error('❌ Erreur auth:', error);
        
        // Afficher un message d'erreur
        document.getElementById('loginPage').style.display = 'flex';
        document.getElementById('dashboardPage').style.display = 'none';
        
        // Afficher une erreur plus explicite si nécessaire
        if (error.message.includes('fetch')) {
            showLoginError('Impossible de contacter le serveur', 'server');
        }
    }
}

function showLoginError(message, type = 'login') {
    const errorDiv = document.getElementById(type === 'login' ? 'loginError' : 'loginServerError');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    
    // Masquer après 5 secondes
    setTimeout(() => {
        errorDiv.classList.add('hidden');
    }, 5000);
}

async function login() {
    console.log('🔑 Tentative de connexion...');
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const loginBtn = document.getElementById('loginBtn');
    const errorDiv = document.getElementById('loginError');
    const serverErrorDiv = document.getElementById('loginServerError');
    
    // Cacher les erreurs précédentes
    errorDiv.classList.add('hidden');
    serverErrorDiv.classList.add('hidden');
    
    if (!username || !password) {
        errorDiv.textContent = 'Veuillez remplir tous les champs';
        errorDiv.classList.remove('hidden');
        return;
    }
    
    // Désactiver le bouton pendant la requête
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connexion...';
    
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('📥 Réponse login:', data);
        
        if (data.success) {
            console.log('✅ Connexion réussie');
            checkAuth();
        } else {
            errorDiv.textContent = data.error || 'Identifiants incorrects';
            errorDiv.classList.remove('hidden');
        }
    } catch (error) {
        console.error('❌ Erreur réseau:', error);
        serverErrorDiv.textContent = 'Erreur de connexion au serveur. Vérifiez votre connexion.';
        serverErrorDiv.classList.remove('hidden');
    } finally {
        // Réactiver le bouton
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Se connecter';
    }
}

async function logout() {
    try {
        await fetch('/api/admin/logout', { method: 'POST' });
        checkAuth();
    } catch (error) {
        console.error('Erreur logout:', error);
        // Forcer la déconnexion côté client
        window.location.reload();
    }
}

async function refreshData() {
    await loadData(currentRange);
}

function showLoading() {
    isLoading = true;
    document.getElementById('loadingIndicator').classList.remove('hidden');
}

function hideLoading() {
    isLoading = false;
    document.getElementById('loadingIndicator').classList.add('hidden');
}

async function loadData(range = '24h') {
    if (isLoading) return;
    
    showLoading();
    currentRange = range;
    
    // Mettre à jour les boutons actifs
    const buttons = document.querySelectorAll('.time-filter');
    buttons.forEach(btn => {
        btn.classList.remove('active', 'bg-yellow-600');
        btn.classList.add('bg-gray-800');
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
        activeBtn.classList.remove('bg-gray-800');
    }
    
    // Charger toutes les données en parallèle
    try {
        await Promise.all([
            loadOverview(range),
            loadCountries(),
            loadDevices(),
            loadBrowsers(),
            loadPages(),
            loadLatestVisits(),
            loadSales(),
            loadTrafficChart(range)
        ]);
        
        // Mettre à jour l'horodatage
        document.getElementById('lastUpdate').innerHTML = `<i class="far fa-clock mr-1"></i>${new Date().toLocaleTimeString('fr-FR')}`;
    } catch (error) {
        console.error('Erreur lors du chargement des données:', error);
        
        // Afficher une notification d'erreur (optionnel)
        const toast = document.createElement('div');
        toast.className = 'fixed top-4 right-4 bg-red-500/90 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate__animated animate__fadeIn';
        toast.textContent = 'Erreur de chargement des données';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    } finally {
        hideLoading();
    }
}

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

async function loadOverview(range) {
    try {
        const data = await fetchWithTimeout(`/api/admin/stats/overview?range=${range}`);
        
        document.getElementById('totalVisits').textContent = data.totalVisits || 0;
        document.getElementById('uniqueVisitors').textContent = data.uniqueVisitors || 0;
        document.getElementById('totalSales').textContent = data.totalSales || 0;
        document.getElementById('totalRevenue').textContent = (data.totalRevenue || 0) + '€';
        document.getElementById('conversionRate').textContent = (data.conversionRate || 0) + '%';
    } catch (error) {
        console.error('Erreur overview:', error);
        // Mettre des valeurs par défaut
        document.getElementById('totalVisits').textContent = '0';
        document.getElementById('uniqueVisitors').textContent = '0';
        document.getElementById('totalSales').textContent = '0';
        document.getElementById('totalRevenue').textContent = '0€';
        document.getElementById('conversionRate').textContent = '0%';
    }
}

async function loadCountries() {
    try {
        const countries = await fetchWithTimeout('/api/admin/stats/countries');
        
        if (!countries || countries.length === 0) {
            document.getElementById('countriesList').innerHTML = '<div class="text-gray-500 text-center py-4">Aucune donnée</div>';
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
        document.getElementById('countriesList').innerHTML = '<div class="text-red-500 text-center py-4">Erreur de chargement</div>';
    }
}

async function loadDevices() {
    try {
        const devices = await fetchWithTimeout('/api/admin/stats/devices');
        
        if (!devices || devices.length === 0) {
            document.getElementById('devicesList').innerHTML = '<div class="text-gray-500 text-center py-4">Aucune donnée</div>';
            return;
        }
        
        const html = devices.map(d => {
            const icons = {
                'Mobile': '📱',
                'Tablette': '📟',
                'Ordinateur': '💻',
                'Inconnu': '❓'
            };
            const icon = icons[d.device_type] || '❓';
            
            return `
                <div class="flex justify-between items-center">
                    <span>${icon} ${d.device_type || 'Inconnu'}</span>
                    <span class="text-yellow-500 font-bold">${d.count}</span>
                </div>
            `;
        }).join('');
        
        document.getElementById('devicesList').innerHTML = html;
    } catch (error) {
        console.error('Erreur appareils:', error);
        document.getElementById('devicesList').innerHTML = '<div class="text-red-500 text-center py-4">Erreur de chargement</div>';
    }
}

async function loadBrowsers() {
    try {
        const browsers = await fetchWithTimeout('/api/admin/stats/browsers');
        
        if (!browsers || browsers.length === 0) {
            document.getElementById('browsersList').innerHTML = '<div class="text-gray-500 text-center py-4">Aucune donnée</div>';
            return;
        }
        
        const html = browsers.map(b => {
            const icons = {
                'Chrome': '🌐',
                'Firefox': '🦊',
                'Safari': '🧭',
                'Edge': '📘',
                'Opera': '🎭',
                'Inconnu': '❓'
            };
            const icon = icons[b.browser] || '🌍';
            
            return `
                <div class="flex justify-between items-center">
                    <span>${icon} ${b.browser || 'Inconnu'}</span>
                    <span class="text-yellow-500 font-bold">${b.count}</span>
                </div>
            `;
        }).join('');
        
        document.getElementById('browsersList').innerHTML = html;
    } catch (error) {
        console.error('Erreur navigateurs:', error);
        document.getElementById('browsersList').innerHTML = '<div class="text-red-500 text-center py-4">Erreur de chargement</div>';
    }
}

async function loadPages() {
    try {
        const pages = await fetchWithTimeout('/api/admin/stats/pages');
        
        if (!pages || pages.length === 0) {
            document.getElementById('pagesList').innerHTML = '<div class="text-gray-500 text-center py-4">Aucune donnée</div>';
            return;
        }
        
        const html = pages.map(p => `
            <div class="flex justify-between items-center">
                <span class="truncate max-w-xs">${p.page_visited || '/'}</span>
                <span class="text-yellow-500 font-bold">${p.views}</span>
            </div>
        `).join('');
        
        document.getElementById('pagesList').innerHTML = html;
    } catch (error) {
        console.error('Erreur pages:', error);
        document.getElementById('pagesList').innerHTML = '<div class="text-red-500 text-center py-4">Erreur de chargement</div>';
    }
}

async function loadLatestVisits() {
    try {
        const visits = await fetchWithTimeout('/api/admin/visits/latest');
        
        if (!visits || visits.length === 0) {
            document.getElementById('latestVisits').innerHTML = '<tr><td colspan="6" class="text-center py-4">Aucune visite</td></tr>';
            return;
        }
        
        const html = visits.map(v => `
            <tr class="border-b border-white/5 hover:bg-white/5">
                <td class="py-2">${v.country || '🌍 Inconnu'}</td>
                <td class="py-2">${v.city || '-'}</td>
                <td class="py-2">
                    <span class="flex items-center gap-1">
                        ${v.device_type === 'Mobile' ? '📱' : v.device_type === 'Tablette' ? '📟' : '💻'}
                        ${v.device_type || 'Inconnu'}
                    </span>
                </td>
                <td class="py-2">${v.browser || 'Inconnu'}</td>
                <td class="py-2">
                    <span class="bg-gray-800 px-2 py-1 rounded text-xs">
                        ${v.page_visited || '/'}
                    </span>
                </td>
                <td class="py-2 text-gray-400">${new Date(v.visit_time).toLocaleString('fr-FR')}</td>
            </tr>
        `).join('');
        
        document.getElementById('latestVisits').innerHTML = html;
    } catch (error) {
        console.error('Erreur visites:', error);
        document.getElementById('latestVisits').innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-500">Erreur de chargement</td></tr>';
    }
}

async function loadSales() {
    try {
        const sales = await fetchWithTimeout('/api/admin/sales/latest');
        
        if (!sales || sales.length === 0) {
            document.getElementById('latestSales').innerHTML = '<tr><td colspan="5" class="text-center py-4">Aucune vente</td></tr>';
            return;
        }
        
        const html = sales.map(s => `
            <tr class="border-b border-white/5 hover:bg-white/5">
                <td class="py-2">${s.customer_name || 'Client'}</td>
                <td class="py-2 text-gray-400">${s.customer_email}</td>
                <td class="py-2 text-yellow-500 font-bold">${s.amount}€</td>
                <td class="py-2 text-gray-400">${new Date(s.created_at).toLocaleString('fr-FR')}</td>
                <td class="py-2">
                    <span class="px-2 py-1 rounded-full text-xs ${s.status === 'paid' ? 'bg-green-500/20 text-green-500' : 'bg-purple-500/20 text-purple-500'}">
                        ${s.status === 'paid' ? '✅ Payé' : '🎁 Gratuit'}
                    </span>
                </td>
            </tr>
        `).join('');
        
        document.getElementById('latestSales').innerHTML = html;
    } catch (error) {
        console.error('Erreur ventes:', error);
        document.getElementById('latestSales').innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-500">Erreur de chargement</td></tr>';
    }
}

async function loadTrafficChart(range) {
    try {
        const data = await fetchWithTimeout(`/api/admin/stats/timeline?range=${range}`);
        
        if (!data || data.length === 0) {
            console.log('Aucune donnée pour le graphique');
            return;
        }
        
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
                    fill: true,
                    pointBackgroundColor: '#D4AF37',
                    pointBorderColor: '#fff',
                    pointHoverBackgroundColor: '#fff',
                    pointHoverBorderColor: '#D4AF37'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.8)',
                        titleColor: '#D4AF37',
                        bodyColor: '#fff',
                        borderColor: '#D4AF37',
                        borderWidth: 1
                    }
                },
                scales: {
                    y: { 
                        beginAtZero: true,
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        ticks: { color: '#9CA3AF' }
                    },
                    x: { 
                        grid: { display: false },
                        ticks: { color: '#9CA3AF' }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Erreur graphique:', error);
    }
}
