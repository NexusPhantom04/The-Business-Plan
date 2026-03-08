// server.js - Serveur Express principal
require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const useragent = require('express-useragent');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const stripeWebhook = require('./webhook/stripe-webhook');
const fs = require('fs');
const axios = require('axios');

const app = express();

// ============================================
// 1. CONFIGURATION DE LA BASE DE DONNÉES
// ============================================
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('❌ Erreur de connexion à la base de données:', err);
    } else {
        console.log('✅ Connecté à la base de données SQLite');
        initDatabase();
        
        // ✅ Passage de la DB au webhook
        stripeWebhook.setDatabase(db);
    }
});

function initDatabase() {
    // Table des visites/analytics
    db.run(`
        CREATE TABLE IF NOT EXISTS visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip_address TEXT,
            country TEXT,
            city TEXT,
            device_type TEXT,
            browser TEXT,
            os TEXT,
            page_visited TEXT,
            referrer TEXT,
            visit_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            session_id TEXT
        )
    `);

    // Table des ventes
    db.run(`
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stripe_session_id TEXT UNIQUE,
            customer_email TEXT,
            customer_name TEXT,
            amount INTEGER,
            currency TEXT,
            status TEXT,
            ebook_ids TEXT,
            download_token TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Table des téléchargements
    db.run(`
        CREATE TABLE IF NOT EXISTS downloads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER,
            ip_address TEXT,
            downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sale_id) REFERENCES sales(id)
        )
    `);

    // Table des utilisateurs admin
    db.run(`
        CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Créer un admin par défaut
    const bcrypt = require('bcrypt');
    const defaultPassword = 'admin123';
    const hash = bcrypt.hashSync(defaultPassword, 10);
    
    db.run(`INSERT OR IGNORE INTO admin_users (username, password_hash) VALUES (?, ?)`, 
        ['admin', hash]);
    
    console.log('✅ Tables initialisées');
}

// ============================================
// 2. MIDDLEWARES (ORDRE CRITIQUE)
// ============================================

// Middleware de base
app.use(cors());
app.use(cookieParser());

// ⚠️ LE WEBHOOK STRIPE DOIT ÊTRE AVANT express.json() ⚠️
app.post('/webhook/stripe', express.raw({type: 'application/json'}), (req, res, next) => {
    console.log('🔔 Webhook appelé');
    console.log('📦 Type body:', typeof req.body);
    console.log('📦 Est Buffer:', Buffer.isBuffer(req.body));
    next();
}, stripeWebhook.handleWebhook);

// Ensuite seulement le parsing JSON
app.use(express.json());
app.use(useragent.express());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Trop de requêtes, veuillez réessayer plus tard.'
});
app.use('/api/', limiter);

// Session
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Helmet à la fin (désactivé pour le dev)
app.use(helmet({
    contentSecurityPolicy: false,
}));

// Fichiers statiques
app.use(express.static(path.join(__dirname, '.')));

// ============================================
// 3. MIDDLEWARE DE TRACKING
// ============================================
app.post('/track/visit', async (req, res) => {
    try {
        const ip = req.headers['cf-connecting-ip'] || 
                  req.headers['x-forwarded-for'] || 
                  req.ip || 
                  '0.0.0.0';
        
        const cleanIp = ip.split(',')[0].trim();
        const userAgent = req.useragent;
        
        let country = 'Inconnu';
        let city = 'Inconnu';
        
        try {
            const geoResponse = await axios.get(`http://ip-api.com/json/${cleanIp}?fields=country,city,status`);
            if (geoResponse.data.status === 'success') {
                country = geoResponse.data.country;
                city = geoResponse.data.city;
            }
        } catch (geoError) {
            console.error('Erreur géolocalisation:', geoError.message);
        }
        
        let deviceType = 'Ordinateur';
        if (userAgent.isMobile) deviceType = 'Mobile';
        else if (userAgent.isTablet) deviceType = 'Tablette';
        
        let browser = userAgent.browser || 'Inconnu';
        const page = req.body.page || req.query.page || '/';
        const referrer = req.headers.referer || req.headers.referrer || 'Direct';
        
        let sessionId = req.cookies.session_id;
        if (!sessionId) {
            sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
            res.cookie('session_id', sessionId, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true });
        }
        
        db.run(`
            INSERT INTO visits (ip_address, country, city, device_type, browser, os, page_visited, referrer, session_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            cleanIp, 
            country, 
            city, 
            deviceType, 
            browser, 
            userAgent.os || 'Inconnu', 
            page, 
            referrer, 
            sessionId
        ]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Erreur tracking:', error);
        res.json({ success: false });
    }
});

// ============================================
// 4. API DASHBOARD
// ============================================
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        next();
    } else {
        res.status(401).json({ error: 'Non authentifié' });
    }
}

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const bcrypt = require('bcrypt');
    
    db.get('SELECT * FROM admin_users WHERE username = ?', [username], (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Identifiants invalides' });
        }
        
        if (bcrypt.compareSync(password, user.password_hash)) {
            req.session.authenticated = true;
            req.session.userId = user.id;
            res.json({ success: true });
        } else {
            res.status(401).json({ error: 'Identifiants invalides' });
        }
    });
});

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/admin/check-auth', (req, res) => {
    res.json({ authenticated: !!req.session.authenticated });
});

// Statistiques générales
app.get('/api/admin/stats/overview', requireAuth, (req, res) => {
    const timeRange = req.query.range || '7d';
    let dateFilter = '';
    
    switch(timeRange) {
        case '24h': dateFilter = "AND visit_time > datetime('now', '-1 day')"; break;
        case '7d': dateFilter = "AND visit_time > datetime('now', '-7 days')"; break;
        case '30d': dateFilter = "AND visit_time > datetime('now', '-30 days')"; break;
        case 'all': dateFilter = ''; break;
    }
    
    db.serialize(() => {
        db.get(`SELECT COUNT(*) as total FROM visits WHERE 1=1 ${dateFilter}`, [], (err, totalVisits) => {
            db.get(`SELECT COUNT(DISTINCT session_id) as uniques FROM visits WHERE 1=1 ${dateFilter}`, [], (err, uniqueVisitors) => {
                db.get(`SELECT COUNT(*) as total, SUM(amount) as revenue FROM sales WHERE status = 'paid'`, [], (err, sales) => {
                    db.get(`SELECT COUNT(*) as today FROM visits WHERE DATE(visit_time) = DATE('now')`, [], (err, todayVisits) => {
                        res.json({
                            totalVisits: totalVisits?.total || 0,
                            uniqueVisitors: uniqueVisitors?.uniques || 0,
                            totalSales: sales?.total || 0,
                            totalRevenue: sales?.revenue || 0,
                            todayVisits: todayVisits?.today || 0,
                            conversionRate: totalVisits?.total > 0 
                                ? ((sales?.total || 0) / totalVisits.total * 100).toFixed(2) 
                                : 0
                        });
                    });
                });
            });
        });
    });
});

// Statistiques par pays
app.get('/api/admin/stats/countries', requireAuth, (req, res) => {
    db.all(`
        SELECT country, COUNT(*) as count, COUNT(DISTINCT session_id) as uniques
        FROM visits 
        GROUP BY country 
        ORDER BY count DESC
        LIMIT 20
    `, [], (err, rows) => {
        res.json(rows || []);
    });
});

// Statistiques par appareil
app.get('/api/admin/stats/devices', requireAuth, (req, res) => {
    db.all(`
        SELECT device_type, COUNT(*) as count 
        FROM visits 
        GROUP BY device_type
    `, [], (err, rows) => {
        res.json(rows || []);
    });
});

// Statistiques par navigateur
app.get('/api/admin/stats/browsers', requireAuth, (req, res) => {
    db.all(`
        SELECT browser, COUNT(*) as count 
        FROM visits 
        GROUP BY browser 
        ORDER BY count DESC
    `, [], (err, rows) => {
        res.json(rows || []);
    });
});

// Pages les plus visitées
app.get('/api/admin/stats/pages', requireAuth, (req, res) => {
    db.all(`
        SELECT page_visited, COUNT(*) as views, COUNT(DISTINCT session_id) as uniques
        FROM visits 
        GROUP BY page_visited 
        ORDER BY views DESC
        LIMIT 20
    `, [], (err, rows) => {
        res.json(rows || []);
    });
});

// Trafic dans le temps
app.get('/api/admin/stats/timeline', requireAuth, (req, res) => {
    const range = req.query.range || '7d';
    let groupBy = 'DATE(visit_time)';
    let limit = 7;
    
    if (range === '24h') {
        groupBy = "strftime('%H', visit_time) || ':00'";
        limit = 24;
    } else if (range === '30d') {
        groupBy = 'DATE(visit_time)';
        limit = 30;
    }
    
    db.all(`
        SELECT ${groupBy} as time_period, COUNT(*) as visits
        FROM visits 
        GROUP BY ${groupBy}
        ORDER BY visit_time DESC
        LIMIT ?
    `, [limit], (err, rows) => {
        res.json((rows || []).reverse());
    });
});

// Dernières ventes
app.get('/api/admin/sales/latest', requireAuth, (req, res) => {
    db.all(`
        SELECT * FROM sales 
        WHERE status = 'paid' 
        ORDER BY created_at DESC 
        LIMIT 20
    `, [], (err, rows) => {
        res.json(rows || []);
    });
});

// Dernières visites
app.get('/api/admin/visits/latest', requireAuth, (req, res) => {
    db.all(`
        SELECT * FROM visits 
        ORDER BY visit_time DESC 
        LIMIT 50
    `, [], (err, rows) => {
        res.json(rows || []);
    });
});

// ============================================
// 5. TÉLÉCHARGEMENT
// ============================================
app.get('/download/:token', (req, res) => {
    const token = req.params.token;
    
    db.get(`
        SELECT s.* FROM sales s
        WHERE s.download_token = ? AND s.status = 'paid'
    `, [token], (err, sale) => {
        if (err || !sale) {
            return res.status(404).send('Lien de téléchargement invalide ou expiré');
        }
        
        const ip = req.headers['x-forwarded-for'] || req.ip;
        db.run(`
            INSERT INTO downloads (sale_id, ip_address) VALUES (?, ?)
        `, [sale.id, ip]);
        
        // Remplace par TON ID de dossier Google Drive
        const fileUrl = 'https://drive.google.com/drive/folders/1_4n8_4QH6u5o_0O_l-9BpzUzvOLhOKCq?usp=drive_link';
        res.redirect(fileUrl);
    });
});

// ============================================
// 6. DASHBOARD STATIQUE
// ============================================
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));
app.get('/admin', (req, res) => {
    res.redirect('/dashboard/');
});

// ============================================
// 7. PAIEMENT STRIPE
// ============================================
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'eur',
                    product_data: {
                        name: 'Pack THE BUSINESS PLAN - 7 Ebooks',
                        description: 'Pack complet de 7 ebooks pour maîtriser le business en ligne',
                    },
                    unit_amount: 2700,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${process.env.SITE_URL}/success.html`,
            cancel_url: `${process.env.SITE_URL}/cancel.html`,
        });

        res.json({ sessionId: session.id, url: session.url });
    } catch (error) {
        console.error('❌ Erreur création session:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 8. DÉMARRAGE
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 SERVEUR DÉMARRÉ SUR LE PORT ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/dashbord/`);
    console.log(`🔗 Webhook: http://localhost:${PORT}/webhook/stripe`);
    console.log(`🌐 Site: http://localhost:${PORT}/\n`);
});

process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('❌ Erreur fermeture BDD:', err);
        } else {
            console.log('✅ Base de données fermée');
        }
        process.exit(0);
    });
});

module.exports = { app, db };