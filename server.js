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
        stripeWebhook.setDatabase(db);
    }
});

function initDatabase() {
    console.log('📦 Création des tables...');
    
    // Table admin_users
    db.run(`
        CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, function(err) {
        if (err) {
            console.error('❌ Erreur création table admin:', err);
        } else {
            console.log('✅ Table admin_users créée');
            const bcrypt = require('bcrypt');
            const defaultPassword = 'admin123';
            const hash = bcrypt.hashSync(defaultPassword, 10);
            db.run(`INSERT OR IGNORE INTO admin_users (username, password_hash) VALUES (?, ?)`, 
                ['admin', hash], function(err) {
                    if (err) console.error('❌ Erreur création admin:', err);
                    else console.log('✅ Admin par défaut créé');
            });
        }
    });

    db.run(`CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, ip_address TEXT, country TEXT, city TEXT, device_type TEXT, browser TEXT, os TEXT, page_visited TEXT, referrer TEXT, visit_time DATETIME DEFAULT CURRENT_TIMESTAMP, session_id TEXT)`, (err) => {
        if (err) console.error('❌ Erreur création visites:', err);
        else console.log('✅ Table visits créée');
    });

    db.run(`CREATE TABLE IF NOT EXISTS sales (id INTEGER PRIMARY KEY AUTOINCREMENT, stripe_session_id TEXT UNIQUE, customer_email TEXT, customer_name TEXT, amount INTEGER, currency TEXT, status TEXT, ebook_ids TEXT, download_token TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`, (err) => {
        if (err) console.error('❌ Erreur création sales:', err);
        else console.log('✅ Table sales créée');
    });

    db.run(`CREATE TABLE IF NOT EXISTS downloads (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER, ip_address TEXT, downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (sale_id) REFERENCES sales(id))`, (err) => {
        if (err) console.error('❌ Erreur création downloads:', err);
        else console.log('✅ Table downloads créée');
    });

    console.log('✅ Initialisation des tables terminée');
}

// ============================================
// 2. MIDDLEWARES
// ============================================
app.use(cors());
app.use(cookieParser());

app.post('/webhook/stripe', express.raw({type: 'application/json'}), stripeWebhook.handleWebhook);

app.use(express.json());
app.use(useragent.express());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, '.')));

// ============================================
// 3. TRACKING
// ============================================
app.post('/track/visit', async (req, res) => {
    try {
        const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || '0.0.0.0';
        const cleanIp = ip.split(',')[0].trim();
        const userAgent = req.useragent;
        
        let country = 'Inconnu', city = 'Inconnu';
        try {
            const geoResponse = await axios.get(`http://ip-api.com/json/${cleanIp}?fields=country,city,status`);
            if (geoResponse.data.status === 'success') {
                country = geoResponse.data.country;
                city = geoResponse.data.city;
            }
        } catch (geoError) {}
        
        let deviceType = 'Ordinateur';
        if (userAgent.isMobile) deviceType = 'Mobile';
        else if (userAgent.isTablet) deviceType = 'Tablette';
        
        let sessionId = req.cookies.session_id;
        if (!sessionId) {
            sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
            res.cookie('session_id', sessionId, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true });
        }
        
        db.run(`INSERT INTO visits (ip_address, country, city, device_type, browser, os, page_visited, referrer, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
            [cleanIp, country, city, deviceType, userAgent.browser || 'Inconnu', userAgent.os || 'Inconnu', req.body.page || '/', req.headers.referer || 'Direct', sessionId]);
        
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false });
    }
});

// ============================================
// 4. API DASHBOARD
// ============================================
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) next();
    else res.status(401).json({ error: 'Non authentifié' });
}

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const bcrypt = require('bcrypt');
    db.get('SELECT * FROM admin_users WHERE username = ?', [username], (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'Identifiants invalides' });
        if (bcrypt.compareSync(password, user.password_hash)) {
            req.session.authenticated = true;
            req.session.userId = user.id;
            res.json({ success: true });
        } else res.status(401).json({ error: 'Identifiants invalides' });
    });
});

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/admin/check-auth', (req, res) => {
    res.json({ authenticated: !!req.session.authenticated });
});

app.get('/api/admin/stats/overview', requireAuth, (req, res) => {
    const timeRange = req.query.range || '7d';
    let dateFilter = '';
    if (timeRange === '24h') dateFilter = "AND visit_time > datetime('now', '-1 day')";
    else if (timeRange === '7d') dateFilter = "AND visit_time > datetime('now', '-7 days')";
    else if (timeRange === '30d') dateFilter = "AND visit_time > datetime('now', '-30 days')";
    
    db.get(`SELECT COUNT(*) as total FROM visits WHERE 1=1 ${dateFilter}`, [], (err, totalVisits) => {
        db.get(`SELECT COUNT(DISTINCT session_id) as uniques FROM visits WHERE 1=1 ${dateFilter}`, [], (err, uniqueVisitors) => {
            db.get(`SELECT COUNT(*) as total, SUM(amount) as revenue FROM sales WHERE status = 'paid'`, [], (err, sales) => {
                res.json({
                    totalVisits: totalVisits?.total || 0,
                    uniqueVisitors: uniqueVisitors?.uniques || 0,
                    totalSales: sales?.total || 0,
                    totalRevenue: sales?.revenue || 0,
                    conversionRate: totalVisits?.total > 0 ? ((sales?.total || 0) / totalVisits.total * 100).toFixed(2) : 0
                });
            });
        });
    });
});

// ============================================
// 5. TÉLÉCHARGEMENT
// ============================================
app.get('/download/:token', (req, res) => {
    const token = req.params.token;
    db.get(`SELECT s.* FROM sales s WHERE s.download_token = ? AND s.status = 'paid'`, [token], (err, sale) => {
        if (err || !sale) return res.status(404).send('Lien invalide');
        const ip = req.headers['x-forwarded-for'] || req.ip;
        db.run(`INSERT INTO downloads (sale_id, ip_address) VALUES (?, ?)`, [sale.id, ip]);
        res.redirect('https://drive.google.com/uc?export=download&id=1_4n8_4QH6u5o_0O_l-9BpzUzvOLhOKCq');
    });
});

// ============================================
// 6. DASHBOARD STATIQUE
// ============================================
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));
app.get('/admin', (req, res) => res.redirect('/dashboard/'));

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
                    product_data: { name: 'Pack THE BUSINESS PLAN - 7 Ebooks', description: 'Pack complet de 7 ebooks' },
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
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 8. DÉMARRAGE
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ SERVEUR DÉMARRÉ SUR LE PORT ${PORT}`);
    console.log(`📂 Dashboard: http://localhost:${PORT}/dashboard/`);
    console.log(`🏠 Webhook: http://localhost:${PORT}/webhook/stripe`);
    console.log(`⚡ Site: http://localhost:${PORT}/\n`);
});

process.on('SIGINT', () => {
    db.close(() => {
        console.log('✅ Base de données fermée');
        process.exit(0);
    });
});

module.exports = { app, db };