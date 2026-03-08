// webhook/stripe-webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// On va recevoir db en paramètre
let db;

function setDatabase(database) {
    db = database;
}

// Configuration email
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// IDs de tes fichiers (à remplacer par les tiens)


async function handleWebhook(req, res) {
    const sig = req.headers['stripe-signature'];
    
    // Vérifier que le body est bien un Buffer (données brutes)
    if (!Buffer.isBuffer(req.body) && typeof req.body !== 'string') {
        console.log('⚠️ Webhook: body déjà parsé (requête de test ignorée)');
        return res.json({ received: true });
    }

    try {
        const event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );

        console.log('🎯 Événement reçu:', event.type);

        // Gérer les différents types d'événements
        switch (event.type) {
            case 'checkout.session.completed':
                const session = event.data.object;
                console.log('💰 Paiement reçu ! ID:', session.id);
                console.log('📧 Email client:', session.customer_details?.email);
                await handleSuccessfulPayment(session);
                break;
                
            default:
                console.log(`Événement non géré: ${event.type}`);
        }

        res.json({ received: true });
    } catch (err) {
        console.log(`❌ Erreur signature webhook: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
}

async function handleSuccessfulPayment(session) {
    try {
        // Récupérer les infos du client
        const customerEmail = session.customer_details.email;
        const customerName = session.customer_details.name || 'Client';
        const amount = session.amount_total / 100;
        const currency = session.currency;
        
        console.log('💾 Sauvegarde dans la base de données...');
        
        // Générer un token unique
        const downloadToken = crypto.randomBytes(32).toString('hex');
        
        // Sauvegarder dans la base de données
        db.run(`
            INSERT INTO sales (stripe_session_id, customer_email, customer_name, amount, currency, status, ebook_ids, download_token)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            session.id,
            customerEmail,
            customerName,
            amount,
            currency,
            'paid',
            '1,2,3,4,5,6,7',
            downloadToken
        ], async function(err) {
            if (err) {
                console.error('❌ Erreur sauvegarde vente:', err);
                return;
            }
            
            const saleId = this.lastID;
            console.log('✅ Vente enregistrée ID:', saleId);
            
            // Envoyer l'email
            console.log('📧 Envoi email à', customerEmail);
            await sendConfirmationEmail(customerEmail, customerName, downloadToken, saleId);
            
            // Notifier l'admin
            await notifyAdmin(customerEmail, customerName, amount);
            
            console.log(`✅ Vente terminée: ${customerEmail} - ${amount}${currency}`);
        });
        
    } catch (error) {
        console.error('❌ Erreur traitement paiement:', error);
    }
}

// ... (garde le reste des fonctions sendConfirmationEmail et notifyAdmin identiques)


async function sendConfirmationEmail(email, name, token, saleId) {
    const downloadLink = `https://drive.google.com/drive/folders/1_4n8_4QH6u5o_0O_l-9BpzUzvOLhOKCq?usp=drive_link`;
    
    const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Merci pour votre achat - The Business Plan</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    margin: 0;
                    padding: 0;
                    background-color: #f4f4f4;
                }
                .container {
                    max-width: 600px;
                    margin: 20px auto;
                    padding: 0;
                    background-color: #ffffff;
                    border-radius: 15px;
                    overflow: hidden;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                }
                .header {
                    background: linear-gradient(135deg, #D4AF37 0%, #AA891A 100%);
                    color: white;
                    padding: 40px 30px;
                    text-align: center;
                }
                .header h1 {
                    font-size: 28px;
                    margin: 10px 0 5px;
                    font-weight: 700;
                }
                .header p {
                    font-size: 16px;
                    margin: 0;
                    opacity: 0.9;
                }
                .content {
                    padding: 40px 30px;
                    background: #ffffff;
                }
                .greeting {
                    font-size: 18px;
                    font-weight: 600;
                    color: #D4AF37;
                    margin-bottom: 20px;
                }
                .message {
                    background: #f9f9f9;
                    padding: 25px;
                    border-radius: 10px;
                    margin: 20px 0;
                    border-left: 4px solid #D4AF37;
                }
                .message p {
                    margin: 0 0 15px;
                }
                .message p:last-child {
                    margin-bottom: 0;
                }
                .ebook-list {
                    background: linear-gradient(135deg, #f5f5f5 0%, #eaeaea 100%);
                    padding: 25px;
                    border-radius: 10px;
                    margin: 30px 0;
                }
                .ebook-list h3 {
                    color: #D4AF37;
                    margin-top: 0;
                    margin-bottom: 20px;
                    font-size: 20px;
                    text-align: center;
                }
                .ebook-list ul {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 10px;
                }
                .ebook-list li {
                    padding: 8px 12px;
                    background: white;
                    border-radius: 5px;
                    font-size: 14px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.05);
                }
                .ebook-list li span {
                    color: #D4AF37;
                    font-size: 16px;
                }
                .button-container {
                    text-align: center;
                    margin: 35px 0;
                }
                .button {
                    display: inline-block;
                    padding: 16px 35px;
                    background: linear-gradient(135deg, #D4AF37 0%, #AA891A 100%);
                    color: white;
                    text-decoration: none;
                    border-radius: 50px;
                    font-weight: 700;
                    font-size: 16px;
                    letter-spacing: 0.5px;
                    box-shadow: 0 5px 15px rgba(212, 175, 55, 0.3);
                    transition: transform 0.3s ease;
                }
                .button:hover {
                    transform: translateY(-2px);
                }
                .note {
                    background: #fff8e7;
                    padding: 15px;
                    border-radius: 8px;
                    font-size: 13px;
                    color: #666;
                    text-align: center;
                    margin: 25px 0;
                    border: 1px dashed #D4AF37;
                }
                .signature {
                    text-align: center;
                    margin-top: 30px;
                    padding-top: 20px;
                    border-top: 2px solid #f0f0f0;
                }
                .signature p {
                    margin: 5px 0;
                    font-size: 16px;
                }
                .signature .name {
                    font-size: 20px;
                    font-weight: 700;
                    color: #D4AF37;
                    margin: 10px 0 5px;
                }
                .signature .title {
                    font-size: 14px;
                    color: #999;
                }
                .footer {
                    background: #1a1a1a;
                    color: #888;
                    text-align: center;
                    padding: 25px;
                    font-size: 12px;
                }
                .footer p {
                    margin: 5px 0;
                }
                .footer a {
                    color: #D4AF37;
                    text-decoration: none;
                }
                .emoji {
                    font-size: 20px;
                }
                @media only screen and (max-width: 600px) {
                    .container { margin: 10px; }
                    .content { padding: 25px; }
                    .ebook-list ul { grid-template-columns: 1fr; }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <!-- HEADER -->
                <div class="header">
                    <div style="font-size: 48px; margin-bottom: 10px;">📚✨</div>
                    <h1>Félicitations ${name} !</h1>
                    <p>Votre pack THE BUSINESS PLAN est prêt</p>
                </div>

                <!-- CONTENU PRINCIPAL -->
                <div class="content">
                    <div class="greeting">
                        👋 Bonjour ${name},
                    </div>

                    <!-- MESSAGE DE REMERCIEMENT -->
                    <div class="message">
                        <p style="font-size: 16px;">🎩 <strong>The Chief Executive Officer of The Business Plan</strong> vous adresse ses plus vifs remerciements pour votre confiance et votre commande récente.</p>
                        
                        <p style="font-size: 16px;">✨ <strong>Félicitations pour votre excellent choix !</strong> Votre décision honore notre engagement pour la qualité et nous motive à toujours mieux vous servir.</p>
                        
                        <p style="font-size: 16px;">💎 Nous sommes certains que notre produit saura répondre à vos attentes les plus exigeantes. Votre satisfaction est notre plus belle récompense.</p>
                        
                        <p style="font-size: 16px;">💬 Si l'expérience vous a plu, nous serions honorés que vous en partagiez le récit autour de vous — votre recommandation est le plus précieux des compliments.</p>
                        
                        <p style="font-size: 16px;">💻 <em>Il vous est conseillé d'utiliser un PC pour profiter pleinement de votre achat.</em></p>
                    </div>

                    <!-- LISTE DES EBOOKS -->
                    <div class="ebook-list">
                        <h3>📦 VOTRE PACK CONTIENT </h3>
                        <ul>
                            <li><span>🧠</span> Mindset Millionnaire</li>
                            <li><span>📈</span> Marketing Digital</li>
                            <li><span>🛒</span> LA BIBLE SHOPIFY</li>
                            <li><span>💰</span> Investissement Crypto</li>
                            <li><span>💡</span> 7 idées de Business</li>
                            <li><span>🕊️</span> L'art et l'argent</li>
                            <li><span>🔑</span> 28 Millions de vues TikTok</li>
                        </ul>
                    </div>

                    <!-- BOUTON DE TÉLÉCHARGEMENT -->
                    <div class="button-container">
                        <a href="${downloadLink}" class="button">
                            ⬇️ TÉLÉCHARGER MAINTENANT
                        </a>
                    </div>

                    <!-- NOTE DE SÉCURITÉ -->
                    <div class="note">
                        <span style="font-size: 18px; margin-right: 5px;">🔒</span>
                        <strong>Lien personnel et sécurisé</strong><br>
                        Ce lien est unique et ne doit pas être partagé. Il expirera après 5 téléchargements.
                    </div>

                    <!-- SIGNATURE -->
                    <div class="signature">
                        <p>Dans l'attente de vous revoir très bientôt,</p>
                        <p class="name">✨ dath4927 ✨</p>
                        <p class="title">CEO & Fondateur</p>
                        <p style="font-size: 18px; margin-top: 10px;">🎩 <strong>The Business Plan</strong></p>
                    </div>
                </div>

                <!-- FOOTER -->
                <div class="footer">
                    <p>© 2026 THE BUSINESS PLAN | L'Elite. Tous droits réservés.</p>
                    <p>N° de commande: #${25 + saleId}</p>
                    <p>
                        <a href="#">Mentions légales</a> • 
                        <a href="#">Confidentialité</a> • 
                        <a href="#">Contact</a>
                    </p>
                    <p style="margin-top: 15px; font-size: 11px;">
                        ✨ Transformez votre vie financière avec THE BUSINESS PLAN ✨
                    </p>
                </div>
            </div>
        </body>
        </html>
    `;
    
    const mailOptions = {
        from: `"THE BUSINESS PLAN" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '✅ Votre pack THE BUSINESS PLAN est disponible !',
        html: emailHtml,
        text: `Bonjour ${name},\n\nMerci pour votre achat ! Téléchargez votre pack ici : ${downloadLink}\n\nL'équipe THE BUSINESS PLAN`
    };
    
    try {
        await transporter.sendMail(mailOptions);
        console.log(`📧 Email envoyé à ${email}`);
    } catch (error) {
        console.error('❌ Erreur envoi email:', error);
    }
}
    
 

async function notifyAdmin(customerEmail, customerName, amount) {
    const mailOptions = {
        from: `"THE BUSINESS PLAN" <${process.env.EMAIL_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: '💰 Nouvelle vente !',
        html: `
            <h2>Nouvelle vente réalisée !</h2>
            <p><strong>Client:</strong> ${customerName} (${customerEmail})</p>
            <p><strong>Montant:</strong> ${amount}€</p>
            <p><strong>Date:</strong> ${new Date().toLocaleString('fr-FR')}</p>
        `
    };
    
    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        console.error('Erreur notification admin:', error);
    }
}

module.exports = { handleWebhook, setDatabase };