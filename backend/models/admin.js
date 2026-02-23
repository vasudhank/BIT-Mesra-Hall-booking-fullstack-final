const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
    name: {
        type: String,
        default: 'Admin'
    },
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
    phone: {
      type: String,
      default: ''
    },
  
    otp: String,
    otpExpiry: Date,
    pendingEmail: {
      type: String,
      default: null
    }

});


const Admin = mongoose.model('Admin',adminSchema);

module.exports=Admin;
