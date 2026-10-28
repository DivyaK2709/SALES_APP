// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/auth');
const salesRoutes = require('./routes/sales');
const syncRoutes = require('./routes/sync');
const itemsRoutes = require('./routes/items'); // NEW — item search + price change (mobile app)

const app = express();

app.use(helmet());
app.use(morgan('combined'));
app.use(express.json({ limit: '15mb' }));
app.use(
  cors({
    origin: process.env.CORS_ORIGIN === '*' ? true : process.env.CORS_ORIGIN?.split(','),
  })
);

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/auth', authRoutes);
app.use('/sync', syncRoutes);
app.use('/items', itemsRoutes); // /items/search, /items/price — NEW
app.use('/', salesRoutes); // /sales, /salespurchasemargin, /daywisesales, /deptwisesales, /companies

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error' });
});

const PORT = process.env.PORT || 80;
app.listen(PORT, () => {
  console.log(`🚀 FreshMart API running on port ${PORT}`);
});