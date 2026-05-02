const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
    name: {
        type: String,
        default: 'Admin'
    },
    email:{
        type:String,
        required:true,
        lowercase: true,
        trim: true,
        index: true
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
    },

    // Optional per-account session duration preference (in milliseconds).
    // When set, the backend will use this to set req.session.cookie.maxAge on login/update.
    sessionTimeoutMs: { type: Number, default: null }

});

adminSchema.index({ pendingEmail: 1 }, { sparse: true });


const Admin = mongoose.model('Admin',adminSchema);

module.exports=Admin;
