const mongoose = require('mongoose');

const DB = async() => {
    try{
        await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Database connected');
    }
    catch(err){
        console.log("Database connection failed",err);
    }
}   

module.exports = DB;