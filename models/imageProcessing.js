const { request } = require('express');
const mongoose = require('mongoose');

const IC_ImageProcessingSchema = new mongoose.Schema({
  entity_id: { type: Number, required: true },
  title: { type: String, required: true },
  requestId: { type: String, required: true },
  inputImageUrls: { type: [String], required: true },
  outputImageUrls: { type: [String], default: [] },
  status: { type: String, enum: ['pending', 'in-progress', 'complete'], default: 'pending' },
});

module.exports = mongoose.model('IC_ImageProcessing', IC_ImageProcessingSchema);
