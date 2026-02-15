const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
    email:{
        type:String,
        required:true
    },
    password:{
        type:String,
        required:true
    },

    type: {
    type: String,
    default: 'Admin',
    immutable: true
  },
  
    otp: String,
    otpExpiry: Date

});


const Admin = mongoose.model('Admin',adminSchema);

module.exports=Admin;