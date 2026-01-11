const mongoose = require('mongoose');




const departmentSchema = new mongoose.Schema({
    email:{
        type:String,
        required:true
    },
    password:{
        type:String,
        required:true
    },
    department:{
        type:String,
        required:String
    },
    head:{
        type:String,
        required:String
    },

    resetToken: { type: String, default: null },
  resetTokenExpiry: { type: Date, default: null },
  otp: { type: String, default: null },
otpExpiry: { type: Date, default: null }

});


const Department = mongoose.model('Department',departmentSchema);

module.exports=Department;