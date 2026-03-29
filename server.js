const express = require("express");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const cors = require("cors");
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = 3000;

const GOOGLE_MAPS_API_KEY = "YOUR_GOOGLE_MAPS_API_KEY"; // Replace with your actual key

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

/* MongoDB */

mongoose.connect("mongodb+srv://vaccilink1:vaccilink1@cluster0.97l8vhp.mongodb.net/?appName=Cluster0")
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

/* Email transporter */

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "hospitrack58@gmail.com",
    pass: "qmtf lmzl kuvs purw"
  }
});

/* Vaccination Schedule Logic for Backend */
const VACCINE_BATCHES = [
  {
    age: "At Birth", days: 0, vaccines: [
      { name: "BCG", doseNumber: 1 }, { name: "OPV-0", doseNumber: 1 }, { name: "Hepatitis-B", doseNumber: 1 }, { name: "Vitamin K", doseNumber: 1 }
    ]
  },
  {
    age: "6 Weeks", days: 42, vaccines: [
      { name: "Pentavalent-1", doseNumber: 1 }, { name: "OPV-1", doseNumber: 1 }, { name: "Rotavirus-1", doseNumber: 1 }, { name: "IPV-1", doseNumber: 1 }, { name: "PCV-1", doseNumber: 1 }
    ]
  },
  {
    age: "10 Weeks", days: 70, vaccines: [
      { name: "Pentavalent-2", doseNumber: 2 }, { name: "OPV-2", doseNumber: 2 }, { name: "Rotavirus-2", doseNumber: 2 }, { name: "PCV-2", doseNumber: 2 }
    ]
  },
  {
    age: "14 Weeks", days: 98, vaccines: [
      { name: "Pentavalent-3", doseNumber: 3 }, { name: "OPV-3", doseNumber: 3 }, { name: "Rotavirus-3", doseNumber: 3 }, { name: "IPV-2", doseNumber: 2 }, { name: "PCV-3", doseNumber: 3 }
    ]
  },
  {
    age: "9 Months", days: 270, vaccines: [
      { name: "MR-1", doseNumber: 1 }, { name: "Vitamin A", doseNumber: 1 }
    ]
  },
  {
    age: "16 Months", days: 480, vaccines: [
      { name: "MR-2", doseNumber: 2 }, { name: "DPT Booster", doseNumber: 1 }, { name: "OPV Booster", doseNumber: 1 }
    ]
  }
];

function generateSchedule(childDOB) {
  const dob = new Date(childDOB);
  dob.setHours(0, 0, 0, 0);
  let fullSchedule = [];
  VACCINE_BATCHES.forEach(batch => {
    batch.vaccines.forEach(v => {
      const scheduledDate = new Date(dob);
      scheduledDate.setDate(scheduledDate.getDate() + batch.days);
      fullSchedule.push({
        vaccineName: v.name,
        doseNumber: v.doseNumber,
        dueDate: scheduledDate,
        age: batch.age
      });
    });
  });
  return fullSchedule;
}

function mergeHistory(schedule, history) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return schedule.map(sch => {
    const dbRecord = history.find(h => h.vaccineName === sch.vaccineName && h.doseNumber === sch.doseNumber);
    let status = "upcoming";
    let scheduledDate = sch.dueDate;

    if (dbRecord) {
      if (dbRecord.dateTaken) {
        status = "completed";
      } else if (dbRecord.status === "scheduled") {
        status = "scheduled";
        if (dbRecord.scheduledDate) scheduledDate = new Date(dbRecord.scheduledDate);
      } else if (today > sch.dueDate) {
        status = "overdue";
      }
    } else if (today > sch.dueDate) {
      status = "overdue";
    }
    return { ...sch, status, scheduledDate };
  });
}

let otpStore = {};

/* Schema */

const parentSchema = new mongoose.Schema({

  parentName: String,
  email: String,
  password: String,
  phone: String,

  address: String,
  city: String,
  pincode: String,

  childName: String,
  childDOB: String,
  motherDOB: String,

  hospital: String,
  parentAadhar: String,

  childID: String,

  vaccinationHistory: [{
    vaccineName: String,
    doseNumber: Number,
    scheduledDate: Date,
    dateTaken: Date,
    hospital: String,
    hospitalAddress: String,
    distance: String,
    status: String,
    arrivedToday: { type: Boolean, default: false },
    visitDate: Date
  }]

});

const Parent = mongoose.model("Parent", parentSchema);

const appointmentSchema = new mongoose.Schema({
  childName: String,
  childID: String,
  parentPhone: String,
  vaccineName: String,
  appointmentDate: Date,
  hospital: String
});

const Appointment = mongoose.model("Appointment", appointmentSchema);

/* SEND OTP */

app.post("/send-otp", async (req, res) => {
  const { email } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000);
  otpStore[email] = otp;
  try {
    await transporter.sendMail({
      from: "kashyapdeepa018@gmail.com",
      to: email,
      subject: "VacciLink OTP",
      text: `Your OTP is ${otp}`
    });
    res.json({ message: "OTP sent to email" });
  } catch (err) {
    console.log(err);
    res.json({ message: "Email error" });
  }
});

/* VERIFY OTP */

app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  if (otpStore[email] == otp) {
    delete otpStore[email];
    res.json({ verified: true });
  } else {
    res.json({ verified: false });
  }
});

/* SIGNUP */

app.post("/signup", async (req, res) => {
  try {
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
    const childID = String(Math.abs(
      (childName + parentAadhar).split("").reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0)
    ) % 90000 + 10000);
    const existing = await Parent.findOne({ email });
    if (existing) {
      return res.json({ message: "User already exists" });
    }
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
    res.json({ message: "Signup successful" });
  } catch (err) {
    console.log(err);
    res.json({ message: "Signup error" });
  }
});

/* LOGIN (EMAIL OR PHONE) */

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const parent = await Parent.findOne({
    $and: [
      { password: password },
      {
        $or: [
          { email: email },
          { phone: email }
        ]
      }
    ]
  });
  if (!parent) {
    return res.json({ message: "Invalid login" });
  }
  res.json(parent);
});

/* FETCH USER DATA */

app.get("/parent/:email", async (req, res) => {
  const parent = await Parent.findOne({
    $or: [
      { email: req.params.email },
      { phone: req.params.email }
    ]
  });
  if (!parent) return res.json(null);
  res.json(parent);
});

/* VACCINATION APIs */

app.get("/vaccination/:childID", async (req, res) => {
  try {
    const parent = await Parent.findOne({ childID: req.params.childID });
    if (!parent) return res.json([]);
    res.json(parent.vaccinationHistory);
  } catch (err) {
    console.log(err);
    res.json([]);
  }
});

app.post("/vaccination/add", async (req, res) => {
  try {
    const { childID, vaccineName, doseNumber, scheduledDate, dateTaken, hospital, hospitalAddress, distance, status } = req.body;
    const parent = await Parent.findOne({ childID });
    if (!parent) return res.json({ message: "Parent not found" });

    let record = parent.vaccinationHistory.find(v => v.vaccineName === vaccineName && v.doseNumber == doseNumber);
    if (record) {
      if (scheduledDate) record.scheduledDate = new Date(scheduledDate);
      if (dateTaken) record.dateTaken = new Date(dateTaken);
      if (hospital) record.hospital = hospital;
      if (hospitalAddress) record.hospitalAddress = hospitalAddress;
      if (distance) record.distance = distance;
      if (status) record.status = status;
    } else {
      parent.vaccinationHistory.push({
        vaccineName,
        doseNumber,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
        dateTaken: dateTaken ? new Date(dateTaken) : null,
        hospital: hospital || "",
        hospitalAddress: hospitalAddress || "",
        distance: distance || "",
        status: status || ""
      });
    }

    await parent.save();
    res.json({ message: "Vaccination added/updated successfully" });
  } catch (err) {
    console.log(err);
    res.json({ message: "Error updating vaccination" });
  }
});

app.get("/nearby-clinics", async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ message: "Address is required" });

  try {
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`;
    const geoResponse = await fetch(geocodeUrl);
    const geoData = await geoResponse.json();

    if (geoData.status !== 'OK' || geoData.results.length === 0) {
      return res.json([
        { name: "Apollo Children's Hospital", address: "123 Main St", distance: "1.2 km", distNum: 1.2 },
        { name: "Municipal Vaccination Center", address: "45 West Ave", distance: "2.4 km", distNum: 2.4 },
        { name: "City Health Clinic", address: "89 North Rd", distance: "3.1 km", distNum: 3.1 }
      ]);
    }

    const { lat, lng } = geoData.results[0].geometry.location;
    const radius = 5000;
    const keyword = "vaccination center|hospital|pediatric clinic|health center";
    const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&keyword=${encodeURIComponent(keyword)}&key=${GOOGLE_MAPS_API_KEY}`;

    const placesResponse = await fetch(placesUrl);
    const placesData = await placesResponse.json();

    if (placesData.status !== 'OK') return res.json([]);

    const calcDistance = (lat1, lon1, lat2, lon2) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return (R * c).toFixed(1);
    };

    const clinics = placesData.results.map(place => {
      const pLat = place.geometry.location.lat;
      const pLng = place.geometry.location.lng;
      const dist = calcDistance(lat, lng, pLat, pLng);
      return { name: place.name, address: place.vicinity, distance: dist + " km", distNum: parseFloat(dist) };
    }).sort((a, b) => a.distNum - b.distNum);

    res.json(clinics);
  } catch (err) {
    console.error("Google API Error:", err.message);
    res.status(500).json({ message: "Error fetching nearby clinics" });
  }
});

/* VACCINATOR DASHBOARD API */
app.get("/vaccinator/dashboard", async (req, res) => {
  try {
    const parents = await Parent.find();
    const appointments = await Appointment.find();
    let dashboardData = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Process vaccinations from parent history
    parents.forEach(p => {
      const schedule = generateSchedule(p.childDOB);
      const merged = mergeHistory(schedule, p.vaccinationHistory);

      merged.forEach(v => {
        const schDate = v.scheduledDate || v.dueDate;
        const isToday = schDate && new Date(schDate).toDateString() === today.toDateString();

        // Include Overdue, Today's scheduled, and Upcoming
        if (v.status === "overdue" || (v.status === "scheduled" && isToday) || v.status === "upcoming") {
          const dbRecord = p.vaccinationHistory.find(h => h.vaccineName === v.vaccineName && h.doseNumber === v.doseNumber);
          dashboardData.push({
            id: dbRecord ? dbRecord._id : null,
            childName: p.childName,
            childID: p.childID,
            parentPhone: p.phone,
            vaccineName: v.vaccineName,
            doseNumber: v.doseNumber,
            scheduledDate: schDate,
            status: isToday ? "Today" : (v.status === "overdue" ? "Overdue" : "Upcoming"),
            arrivedToday: dbRecord ? dbRecord.arrivedToday : false,
            type: "vaccination"
          });
        }
      });
    });

    // Process appointments
    appointments.forEach(a => {
      const apptDate = new Date(a.appointmentDate);
      const isToday = apptDate.toDateString() === today.toDateString();
      const diffDays = Math.ceil((apptDate - today) / (1000 * 60 * 60 * 24));

      if (isToday || (diffDays > 0 && diffDays <= 7)) {
        dashboardData.push({
          id: a._id,
          childName: a.childName,
          childID: a.childID,
          parentPhone: a.parentPhone,
          vaccineName: a.vaccineName,
          scheduledDate: a.appointmentDate,
          status: isToday ? "Today" : "Upcoming",
          type: "appointment",
          hospital: a.hospital
        });
      }
    });

    // Sort by priority: Overdue > Today > Upcoming
    const priority = { "Overdue": 1, "Today": 2, "Upcoming": 3 };
    dashboardData.sort((a, b) => (priority[a.status] || 99) - (priority[b.status] || 99));

    res.json(dashboardData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching dashboard data" });
  }
});

/* GET WEEKLY APPOINTMENTS */
app.get("/appointments/week", async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);

    const appointments = await Appointment.find({
      appointmentDate: { $gte: today, $lte: nextWeek }
    }).sort({ appointmentDate: 1 });

    res.json(appointments);
  } catch (err) {
    res.status(500).json({ message: "Error fetching weekly appointments" });
  }
});

/* GET CHILD DETAILS */
app.get("/child/:id", async (req, res) => {
  try {
    const parent = await Parent.findOne({ childID: req.params.id });
    if (!parent) return res.status(404).json({ message: "Child not found" });

    const schedule = generateSchedule(parent.childDOB);
    const merged = mergeHistory(schedule, parent.vaccinationHistory);

    res.json({
      childName: parent.childName,
      childID: parent.childID,
      dob: parent.childDOB,
      parentName: parent.parentName,
      parentPhone: parent.phone,
      address: parent.address,
      vaccinationHistory: merged
    });
  } catch (err) {
    res.status(500).json({ message: "Error fetching child profile" });
  }
});

/* MARK ARRIVED */
app.put("/vaccination/arrived/:childID/:vaccineName/:doseNumber", async (req, res) => {
  try {
    const { childID, vaccineName, doseNumber } = req.params;
    const { arrived } = req.body;

    const parent = await Parent.findOne({ childID });
    if (!parent) return res.status(404).json({ message: "Child not found" });

    let record = parent.vaccinationHistory.find(v => v.vaccineName === vaccineName && v.doseNumber == doseNumber);
    if (!record) {
      // If record doesn't exist, create it from schedule if possible or just add new
      record = { vaccineName, doseNumber, status: "scheduled" };
      parent.vaccinationHistory.push(record);
    }

    record.arrivedToday = arrived;
    if (arrived) {
      record.visitDate = new Date();
    }

    await parent.save();
    res.json({ message: "Arrival status updated" });
  } catch (err) {
    res.status(500).json({ message: "Error updating arrival status" });
  }
});

/* MARK COMPLETED */
app.put("/vaccination/complete/:childID/:vaccineName/:doseNumber", async (req, res) => {
  try {
    const { childID, vaccineName, doseNumber } = req.params;
    const parent = await Parent.findOne({ childID });
    if (!parent) return res.status(404).json({ message: "Child not found" });

    let record = parent.vaccinationHistory.find(v => v.vaccineName === vaccineName && v.doseNumber == doseNumber);
    if (!record) {
      record = { vaccineName, doseNumber };
      parent.vaccinationHistory.push(record);
    }

    record.status = "completed";
    record.dateTaken = new Date();

    // Also remove any related appointment
    await Appointment.findOneAndDelete({ childID, vaccineName });

    await parent.save();
    res.json({ message: "Vaccination marked as completed" });
  } catch (err) {
    res.status(500).json({ message: "Error marking vaccination complete" });
  }
});

/* UNMARK COMPLETED */
app.put("/vaccination/uncomplete/:childID/:vaccineName/:doseNumber", async (req, res) => {
  try {
    const { childID, vaccineName, doseNumber } = req.params;
    const parent = await Parent.findOne({ childID });
    if (!parent) return res.status(404).json({ message: "Child not found" });

    let record = parent.vaccinationHistory.find(v => v.vaccineName === vaccineName && v.doseNumber == doseNumber);
    if (record) {
      record.status = "scheduled"; // Or recalculate based on date? Usually scheduled if undone.
      record.dateTaken = null;
    }

    await parent.save();
    res.json({ message: "Vaccination status reverted" });
  } catch (err) {
    res.status(500).json({ message: "Error reverting vaccination status" });
  }
});

/* RESCHEDULE */
app.put("/vaccination/reschedule/:childID/:vaccineName/:doseNumber", async (req, res) => {
  try {
    const { childID, vaccineName, doseNumber } = req.params;
    const { newDate } = req.body;
    const parent = await Parent.findOne({ childID });
    if (!parent) return res.status(404).json({ message: "Child not found" });

    let record = parent.vaccinationHistory.find(v => v.vaccineName === vaccineName && v.doseNumber == doseNumber);
    if (!record) {
      record = { vaccineName, doseNumber };
      parent.vaccinationHistory.push(record);
    }

    record.scheduledDate = new Date(newDate);
    record.status = "scheduled";

    await parent.save();
    res.json({ message: "Vaccination rescheduled" });
  } catch (err) {
    res.status(500).json({ message: "Error rescheduling vaccination" });
  }
});

/* VACCINATOR MONTHLY UPCOMING API */
app.get("/vaccinator/monthly", async (req, res) => {
  try {
    const parents = await Parent.find();
    let monthlyData = {};
    parents.forEach(p => {
      const schedule = generateSchedule(p.childDOB);
      const merged = mergeHistory(schedule, p.vaccinationHistory);
      merged.forEach(v => {
        if (v.status === "scheduled" || v.status === "upcoming") {
          const date = v.scheduledDate || v.dueDate;
          const monthYear = date.toLocaleString('default', { month: 'long', year: 'numeric' });
          if (!monthlyData[monthYear]) monthlyData[monthYear] = { month: monthYear, count: 0, children: [] };
          monthlyData[monthYear].count++;
          monthlyData[monthYear].children.push({
            childName: p.childName,
            childID: p.childID,
            vaccineName: v.vaccineName,
            doseNumber: v.doseNumber,
            date: date.toDateString()
          });
        }
      });
    });
    res.json(Object.values(monthlyData));
  } catch (err) {
    res.status(500).json({ message: "Error fetching monthly data" });
  }
});

/* VACCINATOR FOLLOW-UP API */
app.get("/vaccinator/followup", async (req, res) => {
  try {
    const parents = await Parent.find();
    let followupList = [];
    parents.forEach(p => {
      const schedule = generateSchedule(p.childDOB);
      const merged = mergeHistory(schedule, p.vaccinationHistory);
      merged.forEach(v => {
        if (v.status === "overdue") {
          const takenDates = p.vaccinationHistory.filter(h => h.dateTaken).map(h => new Date(h.dateTaken));
          const lastVisitDate = takenDates.length > 0 ? new Date(Math.max(...takenDates)).toDateString() : "No visits";
          followupList.push({
            childName: p.childName,
            childID: p.childID,
            age: v.age,
            parentEmail: p.email,
            parentPhone: p.phone,
            vaccineName: v.vaccineName,
            doseNumber: v.doseNumber,
            dueDate: v.dueDate.toDateString(),
            lastVisitDate: lastVisitDate,
            status: "Overdue"
          });
        }
      });
    });
    res.json(followupList);
  } catch (err) {
    res.status(500).json({ message: "Error fetching followup data" });
  }
});

/* SEND REMINDER API */
app.post("/vaccinator/send-reminder", async (req, res) => {
  const { childName, parentEmail, vaccineName, doseNumber, dueDate } = req.body;
  try {
    await transporter.sendMail({
      from: "kashyapdeepa018@gmail.com",
      to: parentEmail,
      subject: "Vaccination Reminder for Your Child",
      text: `Dear Parent,\n\nYour child ${childName} has missed the ${vaccineName} (Dose ${doseNumber}) scheduled on ${dueDate}.\n\nPlease book an appointment as soon as possible.\n\nRegards,\nVacciLink Team`
    });
    res.json({ message: "Reminder sent successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error sending reminder" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});


const bcrypt = require("bcrypt");

/* ================= VACCINATOR SCHEMA ================= */

const vaccinatorSchema = new mongoose.Schema({
  fullName: String,
  email: String,
  phone: String,
  password: String,
  vaccinatorID: String,
  designation: String
});

const Vaccinator = mongoose.model("Vaccinator", vaccinatorSchema);

/* ================= REGISTER ================= */

app.post("/vaccinator/register", async (req, res) => {
  try {

    const { fullName, email, phone, password, vaccinatorID, designation } = req.body;

    const existing = await Vaccinator.findOne({ email });

    if (existing) {
      return res.json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newVaccinator = new Vaccinator({
      fullName,
      email,
      phone,
      password: hashedPassword,
      vaccinatorID,
      designation
    });

    await newVaccinator.save();

    res.json({ message: "Registered successfully!" });

  } catch (err) {
    console.log(err);
    res.json({ message: "Error in registration" });
  }
});