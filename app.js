const express = require('express');
const DB = require('./config/database');
const uploadRouter = require('./routes/api');
const app = express();
require('dotenv').config();

DB()

app.use(uploadRouter)

app.listen(process.env.PORT, () => {
    console.log(`Server started on port ${process.env.PORT}`);
});

