const fs = require("fs");
const csv = require("csv-parser");
const sharp = require("sharp");
const path = require("path");
const axios = require("axios");
const ImageData = require("../models/imageProcessing");
const { v4: uuidv4 } = require('uuid');
const FormData = require("form-data"); 
const { createObjectCsvWriter } = require('csv-writer'); 

const IMGUR_CLIENT_ID = 'de5571aa442104a';

// Upload handler
const uploadHandler = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }

    const requestId = uuidv4(); 
    const entityImagesMap = {}; 
    const webhookUrl = req.body.webhookUrl || null; 

    // Read the uploaded CSV file 
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
            const { EntityID, Title, InputImageUrls } = row;
            const imageUrls = InputImageUrls.split(',').map(url => url.trim());

            // Create or update the entity entry
            if (!entityImagesMap[EntityID]) {
                entityImagesMap[EntityID] = {
                    title: Title,
                    imageUrls: [],
                };
            }
            entityImagesMap[EntityID].imageUrls.push(...imageUrls);
        })
        .on('end', () => {
            res.status(202).json({
                message: 'File validated and processing started',
                requestId, // Return requestId to the client to track the status
            });

            // Start the image processing asynchronously
            processImagesInBackground(entityImagesMap, requestId, webhookUrl).catch((err) => {
                console.error('Error processing images:', err);
            });
        });
};

// Create output CSV file
const createOutputCsv = async (outputData, requestId) => {
    const csvWriter = createObjectCsvWriter({
        path: path.join(__dirname, `../uploads/output_${requestId}.csv`), // Save the CSV file with a unique name
        header: [
            { id: 'EntityID', title: 'EntityID' },
            { id: 'productName', title: 'Product Name' },
            { id: 'inputImageUrls', title: 'Input Image Urls' },
            { id: 'outputImageUrls', title: 'Output Image Urls' },
        ],
    });

    try {
        await csvWriter.writeRecords(outputData); // Write data to the CSV file
        console.log('Output CSV file created successfully');
    } catch (error) {
        console.error('Error creating output CSV:', error);
    }
};

// Asynchronous image processing function
const processImagesInBackground = async (entityImagesMap, requestId, webhookUrl) => {
    try {
        const outputData = []; // Array to hold data for CSV output

        // Process images for each entity
        for (const entityId in entityImagesMap) {
            const { title, imageUrls } = entityImagesMap[entityId];

            console.log(`Processing entity: ${entityId} with title: ${title} and image URLs: ${imageUrls}`);


            // Create a new entry in the database for the entity
            const newEntry = new ImageData({
                requestId,
                title,
                entity_id: entityId,
                inputImageUrls: imageUrls,
                outputImageUrls: [],
                status: 'pending', // Initially set to pending
            });

            await newEntry.save();

            try {
                const outputUrls = await processImages(imageUrls, requestId);

                // Update the database entry with the processed image URLs
                await ImageData.updateOne(
                    { requestId, entity_id: entityId }, // Ensure you're updating the correct entity
                    { outputImageUrls: outputUrls, status: 'complete' }
                );

                // Gather data for the output CSV
                outputData.push({
                    EntityID: outputData.length + 1,
                    productName: title,
                    inputImageUrls: imageUrls.join(', '),
                    outputImageUrls: outputUrls.join(', '),
                });
            } catch (error) {
                console.error(`Error processing entity ${entityId}:`, error);
                await ImageData.updateOne(
                    { requestId, entity_id: entityId },
                    { status: 'failed' } // Update status to failed if there was an error
                );
            }
        }

        // Create the output CSV file
        await createOutputCsv(outputData, requestId);

        // Trigger the webhook to notify completion if a webhook URL is provided
        if (webhookUrl) {
            await triggerWebhook(webhookUrl, requestId, 'complete');
        }
    } catch (error) {
        console.error('Error in background processing:', error);
    }
};


// Webhook trigger function
const triggerWebhook = async (webhookUrl, requestId, status) => {
    try {
        await axios.post(webhookUrl, {
            requestId,
            status,
        });
    } catch (error) {
        console.error('Error triggering webhook:', error);
    }
};

// Function to download the image from a URL
const downloadImage = async (url) => {
    try {
        const response = await axios.get(url, { responseType: "arraybuffer" });
        return Buffer.from(response.data, "binary");
    } catch (error) {
        console.error(`Error downloading image ${url}:`, error);
        throw new Error("Failed to download image");
    }
};

// Function to compress and save the image locally
const compressAndSaveImage = async (imageBuffer, outputPath) => {
    try {
        await sharp(imageBuffer)
            .jpeg({ quality: 50 }) 
            .toFile(outputPath);
    } catch (error) {
        console.error(`Error compressing image: ${outputPath}`, error);
        throw new Error("Failed to compress and save image");
    }
};

// Function to upload the image to Imgur
const uploadToImgur = async (imageBuffer) => {
    const formData = new FormData();
    formData.append('image', imageBuffer);

    const headers = {
        Authorization: `Client-ID ${IMGUR_CLIENT_ID}`,
        ...formData.getHeaders(), // Use getHeaders() from form-data package
    };

    let attempt = 0;
    const maxAttempts = 5;

    while (attempt < maxAttempts) {
        try {
            const response = await axios.post('https://api.imgur.com/3/image', formData, { headers });
            return response.data.data.link; // Return the URL of the uploaded image
        } catch (error) {
            if (error.response && error.response.status === 503) {
                console.warn(`Imgur returned a 503 error. (${attempt + 1}/${maxAttempts})`);
                attempt++;
                await new Promise((resolve) => setTimeout(resolve, 2000)); 
            } else {
                console.error('Error uploading to Imgur:', error.message);
                throw error; 
            }
        }
    }

    throw new Error('Failed to upload image to Imgur after multiple attempts.');
};

// Function to process the images by downloading, compressing, and uploading to Imgur
const processImages = async (imageUrls, requestId) => {
    const outputUrls = [];
    const outputDir = path.join(__dirname, "../uploads/compressed");

    // Create the output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    for (const url of imageUrls) {
        try {
            const imageBuffer = await downloadImage(url);
            const fileName = path.basename(url);
            const outputPath = path.join(outputDir, `${requestId}_${fileName}`); // Use requestId

            await compressAndSaveImage(imageBuffer, outputPath);
            
            // Upload the compressed image to Imgur
            const imgurUrl = await uploadToImgur(imageBuffer);
            outputUrls.push(imgurUrl); // Store the Imgur URL
        } catch (error) {
            console.error(`Error processing image ${url}:`, error);
        }
    }
    return outputUrls;
};

// Status API to check the status of a particular request
const getStatus = async (req, res) => {
    const { requestId } = req.params;

    try {
        // Find all entries for the given requestId
        const entries = await ImageData.find({ requestId });

        if (entries.length === 0) {
            return res.status(404).json({ message: 'Request not found' });
        }

        // Prepare a detailed response with all entries
        const responseData = entries.map(entry => ({
            entityId: entry.entity_id,
            title: entry.title,
            status: entry.status,
            inputImageUrls: entry.inputImageUrls,
            outputImageUrls: entry.outputImageUrls,
        }));

        return res.status(200).json({
            requestId,
            status: 'found',
            entries: responseData,
        });
    } catch (error) {
        console.error('Error fetching status:', error);
        return res.status(500).json({ message: 'Error fetching status' });
    }
};

module.exports = { uploadHandler, getStatus };
