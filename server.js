const express = require("express");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(__dirname));

/* MongoDB */

mongoose.connect("mongodb+srv://vaccilink1:vaccilink1@cluster0.97l8vhp.mongodb.net/?appName=Cluster0")
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.log(err));

/* Email transporter */

const transporter = nodemailer.createTransport({
service:"gmail",
auth:{
user:"kashyapdeepa018@gmail.com",
pass:"kzid ivfd tsze gdwv"
}
});

let otpStore = {};

/* Schema */

const parentSchema = new mongoose.Schema({

parentName:String,
email:String,
password:String,
phone:String,

address:String,
city:String,
pincode:String,

childName:String,
childDOB:String,
motherDOB:String,

hospital:String,
parentAadhar:String,

childID:String,

vaccinationHistory: [{
  vaccineName: String,
  doseNumber: Number,
  scheduledDate: Date,
  dateTaken: Date,
  hospital: String,
  status: String
}]

});

const Parent = mongoose.model("Parent",parentSchema);

/* SEND OTP */

app.post("/send-otp", async(req,res)=>{

const {email} = req.body;

const otp = Math.floor(100000 + Math.random()*900000);

otpStore[email] = otp;

try{

await transporter.sendMail({
from:"kashyapdeepa018@gmail.com",
to:email,
subject:"VacciLink OTP",
text:`Your OTP is ${otp}`
});

res.json({message:"OTP sent to email"});

}catch(err){

console.log(err);
res.json({message:"Email error"});

}

});

/* VERIFY OTP */

app.post("/verify-otp",(req,res)=>{

const {email,otp} = req.body;

if(otpStore[email] == otp){

delete otpStore[email];
res.json({verified:true});

}else{

res.json({verified:false});

}

});

/* SIGNUP */

app.post("/signup", async(req,res)=>{

try{

const {
parentName,
email,
password,
phone,
address,
city,
pincode,
childName,
childDOB,
motherDOB,
hospital,
parentAadhar
} = req.body;

/* Generate Unique 5-Digit Child ID */

const childID = String(Math.abs(
  (childName + parentAadhar).split("").reduce((a,c)=>((a<<5)-a)+c.charCodeAt(0),0)
) % 90000 + 10000);

/* Check existing */

const existing = await Parent.findOne({email});

if(existing){
return res.json({message:"User already exists"});
}

/* Save */

const parent = new Parent({

parentName,
email,
password,
phone,
address,
city,
pincode,
childName,
childDOB,
motherDOB,
hospital,
parentAadhar,
childID

});

await parent.save();

res.json({message:"Signup successful"});

}catch(err){

console.log(err);
res.json({message:"Signup error"});

}

});

/* LOGIN (EMAIL OR PHONE) */

app.post("/login", async(req,res)=>{

const {email,password} = req.body;

const parent = await Parent.findOne({

$and:[
{password:password},
{$or:[
{email:email},
{phone:email}
]}
]

});

if(!parent){
return res.json({message:"Invalid login"});
}

res.json(parent);

});

/* FETCH USER DATA */

app.get("/parent/:email", async(req,res)=>{

const parent = await Parent.findOne({
$or:[
{email:req.params.email},
{phone:req.params.email}
]
});

if(!parent) return res.json(null);

res.json(parent);

});

/* VACCINATION APIs */

app.get("/vaccination/:childID", async(req,res)=>{
  try {
    const parent = await Parent.findOne({childID: req.params.childID});
    if(!parent) return res.json([]);

        // Fetch history and send. Frontend merged the schedule.
        res.json(parent.vaccinationHistory);
  } catch(err) {
    console.log(err);
    res.json([]);
  }
});

app.post("/vaccination/add", async(req,res)=>{
  try {
    const { childID, vaccineName, doseNumber, scheduledDate, dateTaken, hospital } = req.body;
    const parent = await Parent.findOne({ childID });
    if(!parent) return res.json({ message: "Parent not found" });

    let record = parent.vaccinationHistory.find(v => v.vaccineName === vaccineName && v.doseNumber == doseNumber);
    if(record) {
      if(scheduledDate) record.scheduledDate = new Date(scheduledDate);
      if(dateTaken) record.dateTaken = new Date(dateTaken);
      if(hospital) record.hospital = hospital;
    } else {
      parent.vaccinationHistory.push({
        vaccineName,
        doseNumber,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
        dateTaken: dateTaken ? new Date(dateTaken) : null,
        hospital: hospital || ""
      });
    }

    await parent.save();
    res.json({ message: "Vaccination added/updated successfully" });
  } catch(err) {
    console.log(err);
    res.json({ message: "Error updating vaccination" });
  }
});

app.listen(PORT,()=>{
console.log(`Server running at http://localhost:${PORT}`);
});