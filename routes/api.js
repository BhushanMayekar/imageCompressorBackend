const express = require('express');
const uploadRouter = express.Router();
const multer = require('multer');
const { uploadHandler, getStatus } = require('../services/uplaodService');
const upload = multer({dest: 'uploads/'});

uploadRouter.post('/upload',upload.single('file'),uploadHandler)

uploadRouter.get('/status/:requestId', getStatus)

module.exports = uploadRouter