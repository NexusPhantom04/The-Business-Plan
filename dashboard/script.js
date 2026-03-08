// dashboard/script.js


let trafficChart = null;

// Vérifier si déjà connecté au chargement
checkAuth();

async function checkAuth() {
    try {
        const response = await fetch('/api/admin/check-auth');
        const data = await response.json();
        
        if (data.authenticated) {
            document.getElementById('loginPage').style.display = 'none';
            document.getElementById('dashboardPage').style.display = 'block';
            loadData('24h');
        } else {
            document.getElementById('loginPage').style.display = 'flex';
            document.getElementById('dashboardPage').style.display = 'none';
        }
    } catch (error) {
        console.error('Erreur auth:', error);
    }
}

async function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        if (response.ok) {
            checkAuth();
        } else {
            document.getElementById('loginError').classList.remove('hidden');
        }
    } catch (error) {
        console.error('Erreur login:', error);
    }
}

async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    checkAuth();
}

async function loadData(range = '24h') {
    // Mettre à jour les boutons actifs
    document.querySelectorAll('.time-filter').forEach(btn => {
        btn.classList.remove('active', 'bg-yellow-600');
        btn.classList.add('bg-gray-700');
    });
    event.target.classList.add('active', 'bg-yellow-600');
    event.target.classList.remove('bg-gray-700');
    
    // Charger toutes les données
    loadOverview(range);
    loadCountries();
    loadDevices();
    loadBrowsers();
    loadLatestVisits();
    loadSales();
    loadTrafficChart(range);
}

async function loadOverview(range) {
    const response = await fetch(`/api/admin/stats/overview?range=${range}`);
    const data = await response.json();
    
    document.getElementById('totalVisits').textContent = data.totalVisits || 0;
    document.getElementById('uniqueVisitors').textContent = data.uniqueVisitors || 0;
    document.getElementById('totalSales').textContent = data.totalSales || 0;
    document.getElementById('totalRevenue').textContent = data.totalRevenue + '€';
    document.getElementById('conversionRate').textContent = data.conversionRate + '%';
    document.getElementById('lastUpdate').textContent = `Dernière mise à jour: ${new Date().toLocaleTimeString('fr-FR')}`;
}

async function loadCountries() {
    const response = await fetch('/api/admin/stats/countries');
    const countries = await response.json();
    
    const html = countries.map(c => `
        <div class="flex justify-between items-center">
            <span>${c.country || 'Inconnu'}</span>
            <span class="text-yellow-500 font-bold">${c.count} vues</span>
        </div>
    `).join('');
    
    document.getElementById('countriesList').innerHTML = html;
}

async function loadDevices() {
    const response = await fetch('/api/admin/stats/devices');
    const devices = await response.json();
    
    const html = devices.map(d => `
        <div class="flex justify-between items-center">
            <span>${d.device_type || 'Inconnu'}</span>
            <span class="text-yellow-500 font-bold">${d.count}</span>
        </div>
    `).join('');
    
    document.getElementById('devicesList').innerHTML = html;
}

async function loadBrowsers() {
    const response = await fetch('/api/admin/stats/browsers');
    const browsers = await response.json();
    
    const html = browsers.map(b => `
        <div class="flex justify-between items-center">
            <span>${b.browser || 'Inconnu'}</span>
            <span class="text-yellow-500 font-bold">${b.count}</span>
        </div>
    `).join('');
    
    document.getElementById('browsersList').innerHTML = html;
}

async function loadLatestVisits() {
    const response = await fetch('/api/admin/visits/latest');
    const visits = await response.json();
    
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
}

async function loadSales() {
    const response = await fetch('/api/admin/sales/latest');
    const sales = await response.json();
    
    // Tu peux ajouter un tableau des ventes ici
}

async function loadTrafficChart(range) {
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
}

// Mettre à jour toutes les 30 secondes
setInterval(() => loadData('24h'), 30000);
