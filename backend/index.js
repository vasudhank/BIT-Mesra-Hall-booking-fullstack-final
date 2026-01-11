const express = require('express');
const port =  8000;
const app = express();
const db = require('./config/mongoose');
var session = require('express-session');
const MongoStore = require('connect-mongo');
const adminPassport = require('./config/passport');
const departmentPassport = require('./config/department_passport');
const details = require('./routes/constants');
const cors = require('cors')
const path = require('path');
require('dotenv').config();

console.log('ENV EMAIL:', process.env.EMAIL);
console.log('ENV SMS KEY:', process.env.SMS_API_KEY ? 'SET' : 'NOT SET');


app.use(express.json());
app.use(express.urlencoded());

const allowedOrigins = ['http://localhost:3000'];


// const corsOptions ={
//     origin:allowedOrigins,
//     credentials:true,            //access-control-allow-credentials:true
//     optionSuccessStatus:200
// }


const whitelist = ['http://localhost:3000']
const corsOptions = {
  origin:whitelist,
  credentials:true
}
app.use(cors(corsOptions));

app.set('trust proxy', 1)
app.use(session({
  secret: 'rkm seminar',
  resave: true,
  saveUninitialized: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,
    sameSite: 'lax',   // 'none' → 'lax'
    secure: false      // ❌ turn off HTTPS requirement for localhost
  },
  store: MongoStore.create({
    mongoUrl: `mongodb://localhost:27017/seminar_hall`,
    collectionName: "sessions"
  }),
}));



app.use(adminPassport.initialize())
app.use(adminPassport.session())
app.use(departmentPassport.initialize())
app.use(departmentPassport.session())



app.use('/api',require('./index1'));


const rootPath = __dirname.substring(0, __dirname.length - 8);
// app.use(express.static(""));
app.use(express.static(rootPath + '/frontend/build'));
// Any other routes should be handled by the React app
app.get('*', (req, res) => {
  res.sendFile(rootPath + '/frontend/build/index.html');
});








app.listen(port , (err)=>{
    if(err){
        console.log("Error while starting the server ",err);
        return;
    }
    console.log("Server is up and running on port : ",port);

})