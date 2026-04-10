const express = require("express");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const QRCode = require("qrcode");
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = 3000;

app.get("/verify-child.html", (req, res) => {
  let query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  query = query.replace("childId=", "id=");
  res.redirect(`/verify.html${query}`);
});
app.get("/vaccinator/verify-child.html", (req, res) => {
  let query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  query = query.replace("childId=", "id=");
  res.redirect(`/verify.html${query}`);
});

const GOOGLE_MAPS_API_KEY = "your_google_maps_key";

// Allow all origins for local setup
const allowedOrigins = [
  process.env.FRONTEND_URL,          // e.g. https://vaccilink.netlify.app
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5500",           // VS Code Live Server
  "http://127.0.0.1:5500"
].filter(Boolean);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from both root and /frontend
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, "frontend")));

// Root route — opens the landing page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

/* MongoDB */

mongoose.connect("mongodb+srv://vaccilink1:vaccilink1@cluster0.97l8vhp.mongodb.net/?retryWrites=true&w=majority")
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

  let merged = schedule.map(sch => {
    const dbRecord = history.find(
      h => h.vaccineName === sch.vaccineName && h.doseNumber === sch.doseNumber
    );

    let status = "upcoming";
    let scheduledDate = sch.dueDate;

    if (dbRecord) {
      if (dbRecord.dateTaken || dbRecord.status === "completed") {
        status = "completed";
      } else if (dbRecord.status === "scheduled") {
        status = "scheduled";
        if (dbRecord.scheduledDate) {
          scheduledDate = new Date(dbRecord.scheduledDate);
        }
      } else if (today > sch.dueDate) {
        status = "overdue";
      }
    } else if (today > sch.dueDate) {
      status = "overdue";
    }

    return {
      ...sch,
      // ✅ include age from schedule batch
      age: sch.age,
      status,
      scheduledDate,
      dueDate: sch.dueDate,
      hospital: dbRecord ? (dbRecord.hospital || "") : "",
      hospitalAddress: dbRecord ? (dbRecord.hospitalAddress || "") : "",
      dateTaken: dbRecord ? (dbRecord.dateTaken || null) : null,
      centerId: dbRecord ? (dbRecord.centerId || "") : "",
      vaccinatorID: dbRecord ? (dbRecord.vaccinatorID || "") : "",
      arrivedToday: dbRecord ? !!dbRecord.arrivedToday : false,
      visitDate: dbRecord ? (dbRecord.visitDate || null) : null
    };
  });

  // ✅ ADD MISSING DB RECORDS (records in DB not matched to schedule)
  history.forEach(h => {
    const exists = merged.find(
      m => m.vaccineName === h.vaccineName && m.doseNumber === h.doseNumber
    );

    if (!exists) {
      merged.push({
        vaccineName: h.vaccineName,
        doseNumber: h.doseNumber,
        age: "",
        scheduledDate: h.scheduledDate || null,
        dueDate: h.scheduledDate || null,
        status: (h.dateTaken || h.status === "completed") ? "completed" : (h.status || "scheduled"),
        hospital: h.hospital || "",
        hospitalAddress: h.hospitalAddress || "",
        dateTaken: h.dateTaken || null,
        centerId: h.centerId || "",
        vaccinatorID: h.vaccinatorID || "",
        arrivedToday: !!h.arrivedToday,
        visitDate: h.visitDate || null
      });
    }
  });

  return merged;
}

/** Schedule lookup + upsert vaccinationHistory row (no duplicate vaccineName+dose) */
function findScheduleEntry(childDOB, vaccineName, doseNumber) {
  if (!childDOB) return null;
  const schedule = generateSchedule(childDOB);
  return schedule.find(
    s => s.vaccineName === vaccineName && String(s.doseNumber) === String(doseNumber)
  ) || null;
}

function getDoseNumberForVaccine(childDOB, vaccineName) {
  if (!childDOB || !vaccineName) return 1;
  const schedule = generateSchedule(childDOB);
  const m = schedule.find(s => s.vaccineName === vaccineName);
  return m ? m.doseNumber : 1;
}

function upsertVaccinationRecord(parent, vaccineName, doseNumber, patch = {}) {
  const dose = Number(doseNumber);
  const d = Number.isFinite(dose) ? dose : 1;
  let record = parent.vaccinationHistory.find(
    v => v.vaccineName === vaccineName && Number(v.doseNumber) === d
  );
  if (!record) {
    const sch = findScheduleEntry(parent.childDOB, vaccineName, d);
    record = {
      vaccineName,
      doseNumber: d,
      scheduledDate: sch ? sch.dueDate : null,
      dateTaken: null,
      hospital: "",
      hospitalAddress: "",
      centerId: "",
      distance: "",
      status: "upcoming",
      arrivedToday: false
    };
    parent.vaccinationHistory.push(record);
  }
  Object.assign(record, patch);
  return record;
}

let otpStore = {};
/** QR access tokens: token -> { childID, exp } */
let qrTokenStore = {};
/** Vaccinator access OTP: `${childID}:${vaccinatorID}` -> { otp, exp } */
let vaccinatorAccessOtpStore = {};

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

  /** Stable secret embedded in printed QR (one per child); created lazily if missing */
  qrSecret: String,

  childID: String,

  vaccinationHistory: [{
    vaccineName: String,
    doseNumber: Number,
    scheduledDate: Date,
    dateTaken: Date,
    hospital: String,
    hospitalAddress: String,
    centerId: String,
    distance: String,
    status: String,
    arrivedToday: { type: Boolean, default: false },
    visitDate: Date,
    updatedByVaccinator: { type: Boolean, default: false },
    vaccinatorID: String,
    updatedAt: Date,
    certificateId: String,
    issuedAt: Date,
    qrCode: String,
    vaccinatorName: String
  }]

});

const Parent = mongoose.model("Parent", parentSchema);

const appointmentSchema = new mongoose.Schema({
  childName: String,
  childID: String,
  parentPhone: String,
  vaccineName: String,
  doseNumber: { type: Number, default: 1 },
  appointmentDate: Date,
  appointmentTime: { type: String, default: "" },
  hospital: String,
  hospitalAddress: String,
  centerId: String,
  status: { type: String, default: "pending" }, // pending, completed, rejected, accepted
  type: { type: String, default: "online" } // online or onsite
});

const Appointment = mongoose.model("Appointment", appointmentSchema);

/* Center Schema */
const centerSchema = new mongoose.Schema({
  centerId: { type: String, unique: true },
  name: { type: String, required: true },
  address: { type: String, required: true },
  pincode: { type: String, default: "" },
  city: { type: String, default: "" }
});

const Center = mongoose.model("Center", centerSchema);

/* Notification Schema */
const notificationSchema = new mongoose.Schema({
  childID: String,
  childName: String,
  vaccineName: String,
  doseNumber: Number,
  centerId: String,
  hospitalName: String,
  eventDate: Date,
  message: String,
  type: String, // reminder | overdue
  date: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});

const Notification = mongoose.model("Notification", notificationSchema);

async function ensureQrSecret(parent) {
  if (!parent) return null;
  if (parent.qrSecret) return parent.qrSecret;
  parent.qrSecret = crypto.randomBytes(20).toString("hex");
  await parent.save();
  return parent.qrSecret;
}

function formatNotifDateShort(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(dt.getDate()).padStart(2, "0")} ${months[dt.getMonth()]} ${dt.getFullYear()}`;
}

function buildVerifyQrUrl(base, certificateId) {
  const b = String(base || "").replace(/\/$/, "");
  return `${b}/verify.html?id=${encodeURIComponent(certificateId)}`;
}
function notifDedupeKey(item) {
  const d = item.date || item.created_at;
  const day = d ? String(d).slice(0, 10) : "";
  return `${item.type}|${item.vaccine_id || ""}|${day}`;
}

function notificationDocToStructuredApi(doc, childNameFallback) {
  const type = String(doc.type || "reminder").toLowerCase() === "overdue" ? "overdue" : "reminder";
  const child_name = doc.childName || childNameFallback || "";
  const vaccine_name = doc.vaccineName || "";
  const dose = doc.doseNumber != null ? Number(doc.doseNumber) : 1;
  const vaccine_id = vaccine_name ? `${vaccine_name}_${dose}` : "";
  const hospital_name = doc.hospitalName || "";
  const hospital_id = doc.centerId || "";
  const eventD = doc.eventDate || doc.date;
  const ev = eventD instanceof Date ? eventD : new Date(eventD);
  const dateIso = isNaN(ev.getTime()) ? new Date(doc.date).toISOString() : ev.toISOString();
  let message = doc.message || "";
  if (!message) {
    const ds = formatNotifDateShort(ev);
    const hosp = hospital_name || "your clinic";
    if (type === "overdue") {
      message = `Overdue: ${vaccine_name || "Vaccine"} vaccine was missed on ${ds}. Please visit ${hosp}.`;
    } else {
      message = `Reminder: ${child_name} has an upcoming ${vaccine_name || "vaccination"} on ${ds} at ${hosp}.`;
    }
  }
  return {
    type,
    child_id: doc.childID,
    child_name,
    vaccine_name,
    vaccine_id,
    hospital_id,
    hospital_name,
    date: dateIso,
    message,
    created_at: (doc.date instanceof Date ? doc.date : new Date(doc.date)).toISOString(),
    read: !!doc.read
  };
}

function buildDerivedScheduleNotifications(parent, merged) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 30);
  const child_name = parent.childName || "";
  const out = [];
  for (const v of merged) {
    if (v.status === "completed") continue;
    const sched = new Date(v.scheduledDate || v.dueDate);
    if (isNaN(sched.getTime())) continue;
    sched.setHours(0, 0, 0, 0);
    const hospital_name = v.hospital || parent.hospital || "";
    const vaccine_name = v.vaccineName || "";
    const dose = v.doseNumber != null ? v.doseNumber : 1;
    const vaccine_id = vaccine_name ? `${vaccine_name}_${dose}` : "";
    const hospital_id = v.centerId || "";
    const dateIso = sched.toISOString();
    const ds = formatNotifDateShort(sched);
    const hospDisp = hospital_name || "your registered hospital";
    if (v.status === "overdue") {
      out.push({
        type: "overdue",
        child_id: parent.childID,
        child_name,
        vaccine_name,
        vaccine_id,
        hospital_id,
        hospital_name,
        date: dateIso,
        message: `Overdue: ${vaccine_name} vaccine was missed on ${ds}. Please visit ${hospDisp}.`,
        created_at: dateIso,
        read: false,
        source: "schedule"
      });
    } else if (v.status === "scheduled" || v.status === "upcoming") {
      if (sched >= today && sched <= horizon) {
        out.push({
          type: "reminder",
          child_id: parent.childID,
          child_name,
          vaccine_name,
          vaccine_id,
          hospital_id,
          hospital_name,
          date: dateIso,
          message: `Reminder: ${child_name} has an upcoming ${vaccine_name} vaccination on ${ds} at ${hospDisp}.`,
          created_at: dateIso,
          read: false,
          source: "schedule"
        });
      }
    }
  }
  return out;
}

/* Generate unique centerId — CTR + 5 random digits */
async function generateCenterId() {
  let id, exists;
  do {
    id = "CTR" + String(Math.floor(10000 + Math.random() * 90000));
    exists = await Center.findOne({ centerId: id });
  } while (exists);
  return id;
}

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

app.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;
  if (otpStore[email] == otp) {
    delete otpStore[email];
    const parent = await Parent.findOne({ email });
    res.json({ verified: true, childID: parent ? parent.childID : null });
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
    res.json({ message: "Signup successful", childID: childID });
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

/** Stable verify URL for Digital Health ID QR (client passes origin = window.location.origin) */
app.get("/parent/qr-verify-url/:childID", async (req, res) => {
  try {
    const { childID } = req.params;
    const origin = String(req.query.origin || "").trim();
    const parent = await Parent.findOne({ childID });
    if (!parent) return res.status(404).json({ message: "Child not found" });
    const secret = await ensureQrSecret(parent);
    const base = "http://localhost:3000";
    res.json({
      verify_url: buildVerifyQrUrl(base, childID, secret),
      child_id: childID
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error building QR URL" });
  }
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
    const { childID, vaccineName, doseNumber, scheduledDate, dateTaken, hospital, hospitalAddress, distance, status, centerId } = req.body;
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
      if (centerId) record.centerId = centerId;
    } else {
      parent.vaccinationHistory.push({
        vaccineName,
        doseNumber,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
        dateTaken: dateTaken ? new Date(dateTaken) : null,
        hospital: hospital || "",
        hospitalAddress: hospitalAddress || "",
        centerId: centerId || "",
        distance: distance || "",
        status: status || ""
      });
    }

    await parent.save();

    // If it's a scheduled online appointment, create the Appointment record
    if (status === "scheduled" && scheduledDate && centerId) {
      const existingAppt = await Appointment.findOne({ childID, vaccineName, appointmentDate: new Date(scheduledDate) });
      if (!existingAppt) {
        const newAppt = new Appointment({
          childName: parent.childName,
          childID: parent.childID,
          parentPhone: parent.phone,
          vaccineName,
          doseNumber: doseNumber != null ? Number(doseNumber) : getDoseNumberForVaccine(parent.childDOB, vaccineName),
          appointmentDate: new Date(scheduledDate),
          hospital,
          hospitalAddress,
          centerId,
          status: "pending",
          type: "online"
        });
        await newAppt.save();
      }
    }

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

    /* Helper: resolve or create a Center record, returns centerId */
    async function resolveCenter(name, addr, pincode = "", city = "") {
      let center = await Center.findOne({ name: name, address: addr });
      if (!center) {
        const newId = await generateCenterId();
        center = new Center({ centerId: newId, name, address: addr, pincode, city });
        await center.save();
      }
      return center.centerId;
    }

    /* Fallback clinics when Google geocoding fails */
    if (geoData.status !== 'OK' || geoData.results.length === 0) {
      const fallbacks = [
        { name: "Apollo Children's Hospital", address: "123 Main St", distance: "1.2 km", distNum: 1.2 },
        { name: "Municipal Vaccination Center", address: "45 West Ave", distance: "2.4 km", distNum: 2.4 },
        { name: "City Health Clinic", address: "89 North Rd", distance: "3.1 km", distNum: 3.1 }
      ];
      // Ensure fallback centers exist in DB
      for (const fb of fallbacks) {
        fb.centerId = await resolveCenter(fb.name, fb.address);
      }
      return res.json(fallbacks);
    }

    const { lat, lng } = geoData.results[0].geometry.location;

    // Extract pincode from geocode result for city/pincode
    let geoCity = "";
    let geoPincode = "";
    const addrComponents = geoData.results[0].address_components || [];
    addrComponents.forEach(comp => {
      if (comp.types.includes("postal_code")) geoPincode = comp.long_name;
      if (comp.types.includes("locality")) geoCity = comp.long_name;
    });

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

    // Build clinic list and resolve/create center records
    const clinics = [];
    for (const place of placesData.results) {
      const pLat = place.geometry.location.lat;
      const pLng = place.geometry.location.lng;
      const dist = calcDistance(lat, lng, pLat, pLng);
      const centerId = await resolveCenter(place.name, place.vicinity, geoPincode, geoCity);
      clinics.push({
        name: place.name,
        address: place.vicinity,
        distance: dist + " km",
        distNum: parseFloat(dist),
        centerId
      });
    }

    clinics.sort((a, b) => a.distNum - b.distNum);
    res.json(clinics);
  } catch (err) {
    console.error("Google API Error:", err.message);
    res.status(500).json({ message: "Error fetching nearby clinics" });
  }
});

/* GET ALL CENTERS (with optional pincode / city filter) */
app.get("/centers", async (req, res) => {
  try {
    const filter = {};
    if (req.query.pincode) filter.pincode = req.query.pincode;
    if (req.query.city) filter.city = new RegExp(req.query.city, "i");
    const centers = await Center.find(filter).sort({ name: 1 });
    res.json(centers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching centers" });
  }
});

/* VACCINATOR DASHBOARD API */
app.get("/vaccinator/dashboard", async (req, res) => {
  try {
    const { centerId } = req.query;
    if (!centerId) return res.status(400).json({ message: "centerId is required" });

    // For vaccinations, we filter parents who have an appointment at this center 
    // OR we could just fetch all parents for the demo, but true access control means we only see parents linked to this center.
    // Let's filter parents based on appointments or a primary center.
    // A simplified approach for now is fetching all parents but only showing them if they have a scheduled vaccination at this centerId OR are overdue (and we might tie overdues to all vaccinators or a specific default).
    // Let's just retrieve parents who booked here.
    const allAppointments = await Appointment.find({ centerId });
    const childIDsWithAppointments = [...new Set(allAppointments.map(a => a.childID))];

    // Get only parents that have appointments with this center or have visited it before
    const parents = await Parent.find({
      $or: [
        { childID: { $in: childIDsWithAppointments } },
        { "vaccinationHistory.hospital": centerId }
      ]
    });

    const appointments = await Appointment.find({ centerId });
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

        const dbRecord = p.vaccinationHistory.find(h => h.vaccineName === v.vaccineName && h.doseNumber === v.doseNumber);

        const isCompletedToday =
          dbRecord?.dateTaken &&
          new Date(dbRecord.dateTaken).toDateString() === today.toDateString();

        // Include Overdue, Today's scheduled, Upcoming, and Completed Today
        if (v.status === "overdue" || (v.status === "scheduled" && isToday) || v.status === "upcoming" || isCompletedToday) {
          dashboardData.push({
            id: dbRecord ? dbRecord._id : null,
            childName: p.childName,
            childID: p.childID,
            parentPhone: p.phone,
            vaccineName: v.vaccineName,
            doseNumber: v.doseNumber,
            scheduledDate: isCompletedToday ? v.dateTaken : schDate,
            status: isCompletedToday ? "Completed Today" : (isToday ? "Today" : (v.status === "overdue" ? "Overdue" : "Upcoming")),
            arrivedToday: dbRecord ? dbRecord.arrivedToday : false,
            type: "vaccination",
            dateTaken: dbRecord?.dateTaken || null,
            hospital: dbRecord?.hospital || "",
            centerId: dbRecord?.centerId || ""
          });
        }
      });
    });

    // Process appointments (link to parent row for arrivedToday / dose)
    appointments.forEach(a => {
      if (a.status === "completed" || a.status === "rejected") return;
      const apptDate = new Date(a.appointmentDate);
      const isToday = apptDate.toDateString() === today.toDateString();
      const diffDays = Math.ceil((apptDate - today) / (1000 * 60 * 60 * 24));

      const parentRow = parents.find(p => p.childID === a.childID);
      const doseNum = a.doseNumber != null ? Number(a.doseNumber) : (parentRow ? getDoseNumberForVaccine(parentRow.childDOB, a.vaccineName) : 1);
      let arrivedToday = false;
      if (parentRow) {
        const h = parentRow.vaccinationHistory.find(
          x => x.vaccineName === a.vaccineName && Number(x.doseNumber) === doseNum
        );
        arrivedToday = Boolean(h?.arrivedToday);
      }

      if (isToday || (diffDays > 0 && diffDays <= 7) || a.status === "pending") {
        dashboardData.push({
          id: a._id,
          childName: a.childName,
          childID: a.childID,
          parentPhone: a.parentPhone,
          vaccineName: a.vaccineName,
          doseNumber: doseNum,
          scheduledDate: a.appointmentDate,
          status: isToday ? "Today" : "Upcoming",
          appointmentStatus: a.status,
          type: "appointment",
          hospital: a.hospital,
          centerId: a.centerId || "",
          arrivedToday
        });
      }
    });

    // Remove duplicates from dashboardData (we might have same child scheduled from both lists)
    const uniqueDashboardData = [];
    const seen = new Set();
    for (const item of dashboardData) {
      // Prioritize "type" based on UI. If it's appointment type we can keep it.
      const key = `${item.childID}_${item.vaccineName}_${item.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueDashboardData.push(item);
      }
    }

    // Sort by priority: Overdue > Today > Upcoming
    const priority = { "Overdue": 1, "Today": 2, "Upcoming": 3 };
    uniqueDashboardData.sort((a, b) => (priority[a.status] || 99) - (priority[b.status] || 99));

    // ✅ New return format: bucketed lists
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const weekEnd = new Date(todayDate);
    weekEnd.setDate(todayDate.getDate() + 7);

    const parseItemDate = (item) => {
      const d = item.scheduledDate ? new Date(item.scheduledDate) : null;
      if (!d || isNaN(d.getTime())) return null;
      d.setHours(0, 0, 0, 0);
      return d;
    };

    const notCompleted = (item) => {
      if (item.type === "appointment") return item.appointmentStatus !== "completed";
      // vaccination items don't have appointmentStatus; treat "Completed Today" as completed
      return item.status !== "Completed Today";
    };

    const buckets = { today: [], week: [], upcoming: [], overdue: [] };
    uniqueDashboardData.forEach((item) => {
      const d = parseItemDate(item);
      if (!d) return;

      if (d.getTime() === todayDate.getTime()) {
        buckets.today.push(item);
      } else if (d > todayDate && d <= weekEnd) {
        buckets.week.push(item);
      } else if (d < todayDate && notCompleted(item)) {
        buckets.overdue.push(item);
      } else if (d > todayDate) {
        buckets.upcoming.push(item);
      }
    });

    // Sort overdue first, then today, then upcoming (within each bucket by date asc)
    const byDateAsc = (a, b) => {
      const da = parseItemDate(a)?.getTime() || 0;
      const db = parseItemDate(b)?.getTime() || 0;
      return da - db;
    };
    buckets.overdue.sort(byDateAsc);
    buckets.today.sort(byDateAsc);
    buckets.week.sort(byDateAsc);
    buckets.upcoming.sort(byDateAsc);

    res.json(buckets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching dashboard data" });
  }
});

/* GET ALL APPOINTMENTS FOR A CHILD (PARENTS VIEW) */
app.get("/appointments/all/:childID", async (req, res) => {
  try {
    const { childID } = req.params;
    const appointments = await Appointment.find({ childID }).sort({ appointmentDate: -1 });
    res.json(appointments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching appointments" });
  }
});

/** Next upcoming appointment for parent profile (query: child_id) */
app.get("/api/appointments", async (req, res) => {
  try {
    const child_id = req.query.child_id;
    if (!child_id) return res.status(400).json({ message: "child_id is required" });

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const list = await Appointment.find({
      childID: String(child_id),
      status: { $nin: ["completed", "rejected"] },
      appointmentDate: { $gte: now }
    }).sort({ appointmentDate: 1 });

    const next = list[0] || null;
    if (!next) {
      return res.json({ next: null });
    }

    const apptDate = new Date(next.appointmentDate);
    const timeStr = (next.appointmentTime && String(next.appointmentTime).trim())
      ? next.appointmentTime
      : (apptDate.getHours() || apptDate.getMinutes()
        ? apptDate.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
        : "");

    res.json({
      next: {
        vaccine_name: next.vaccineName || "",
        date: apptDate.toISOString(),
        time: timeStr,
        hospital_name: next.hospital || "",
        hospital_id: next.centerId || "",
        dose_number: next.doseNumber
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching next appointment" });
  }
});

/** Latest completed vaccination visit (consultation-style) */
app.get("/api/consultations/latest", async (req, res) => {
  try {
    const child_id = req.query.child_id;
    if (!child_id) return res.status(400).json({ message: "child_id is required" });

    const parent = await Parent.findOne({ childID: String(child_id) });
    if (!parent) {
      return res.json({ latest: null });
    }

    const merged = mergeHistory(generateSchedule(parent.childDOB), parent.vaccinationHistory);
    const completed = merged
      .filter(v => v.status === "completed" && v.dateTaken)
      .map(v => ({ ...v, dt: new Date(v.dateTaken) }))
      .filter(v => !isNaN(v.dt.getTime()))
      .sort((a, b) => b.dt - a.dt);

    const last = completed[0] || null;
    if (!last) {
      return res.json({ latest: null });
    }

    const docLabel = last.vaccinatorID
      ? `Vaccinator (${last.vaccinatorID})`
      : "Vaccination provider";

    res.json({
      latest: {
        doctor_name: docLabel,
        hospital_name: last.hospital || parent.hospital || "",
        visited_date: last.dt.toISOString(),
        vaccine_name: last.vaccineName || ""
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching consultation" });
  }
});

/* GET PAST APPOINTMENTS FOR A CHILD */
app.get("/appointments/past/:childID", async (req, res) => {
  try {
    const { childID } = req.params;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const appointments = await Appointment.find({ childID }).sort({ appointmentDate: -1 });
    const past = appointments.filter(a => new Date(a.appointmentDate) < today);

    res.json(past);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching past appointments" });
  }
});

/* GET WEEKLY APPOINTMENTS */
app.get("/appointments/week", async (req, res) => {
  try {
    const { centerId } = req.query;
    if (!centerId) return res.status(400).json({ message: "centerId is required" });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);

    const appointments = await Appointment.find({
      centerId,
      appointmentDate: { $gte: today, $lte: nextWeek }
    }).sort({ appointmentDate: 1 });

    res.json(appointments);
  } catch (err) {
    res.status(500).json({ message: "Error fetching weekly appointments" });
  }
});

/* VACCINATOR APPOINTMENTS API (ALL) */
app.get("/vaccinator/appointments", async (req, res) => {
  try {
    const { centerId } = req.query;
    if (!centerId) return res.status(400).json({ message: "centerId is required" });

    const appointments = await Appointment.find({ centerId }).sort({ appointmentDate: 1 });
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ message: "Server error updating appointment" });
  }
});

/* SEND REMINDER API */
app.post("/vaccinator/send-reminder", async (req, res) => {
  try {
    const {
      childID,
      centerName,
      childName,
      parentEmail,
      vaccineName,
      doseNumber,
      dueDate,
      hospitalName,
      centerId,
      scheduledDate,
      notifType: notifTypeBody
    } = req.body || {};

    // Support both payload shapes:
    // 1) { childID, centerName, ... }  (dashboard)
    // 2) { childName, parentEmail, vaccineName, doseNumber, dueDate } (follow-up page)
    let parent = null;
    if (childID) parent = await Parent.findOne({ childID });
    if (!parent && parentEmail) parent = await Parent.findOne({ email: parentEmail });

    const toEmail = parent?.email || parentEmail;
    if (!toEmail) return res.status(404).json({ message: "Parent email not found" });

    const finalChildID = parent?.childID || childID || "";
    const finalChildName = parent?.childName || childName || "your child";

    const bodyType = String(notifTypeBody || "").toLowerCase();
    const followupOverdue = Boolean(dueDate && vaccineName);
    let notifType =
      bodyType === "overdue" || bodyType === "reminder"
        ? bodyType
        : followupOverdue
          ? "overdue"
          : "reminder";

    const hospLabel = hospitalName || centerName || parent?.hospital || "your registered center";
    const cid = centerId || "";

    let eventDate = new Date();
    if (followupOverdue && dueDate) {
      const parsed = new Date(dueDate);
      if (!isNaN(parsed.getTime())) eventDate = parsed;
    } else if (scheduledDate) {
      const parsed = new Date(scheduledDate);
      if (!isNaN(parsed.getTime())) eventDate = parsed;
    }

    const doseNum = doseNumber != null && doseNumber !== "" ? Number(doseNumber) : undefined;
    const ds = formatNotifDateShort(eventDate);
    let structuredMessage;
    if (notifType === "overdue") {
      structuredMessage = `Overdue: ${vaccineName || "Vaccine"} vaccine was missed on ${ds}. Please visit ${hospLabel}.`;
    } else if (vaccineName || scheduledDate) {
      structuredMessage = `Reminder: ${finalChildName} has an upcoming ${vaccineName || "vaccination"}${doseNum ? ` (Dose ${doseNum})` : ""} on ${ds} at ${hospLabel}.`;
    } else {
      structuredMessage = `Reminder: ${finalChildName} has an upcoming vaccination. Please book or confirm at ${hospLabel}.`;
    }

    const mailText = `Dear Parent,\n\n${structuredMessage}\n\nRegards,\nVacciLink Team`;

    await transporter.sendMail({
      from: "hospitrack58@gmail.com",
      to: toEmail,
      subject: "Vaccination Reminder",
      text: mailText
    });

    if (finalChildID) {
      await Notification.create({
        childID: finalChildID,
        childName: finalChildName,
        vaccineName: vaccineName || (notifType === "reminder" ? "" : ""),
        doseNumber: doseNum,
        centerId: cid,
        hospitalName: hospLabel,
        eventDate,
        type: notifType,
        message: structuredMessage
      });
    }

    res.json({ message: "Reminder sent successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error sending reminder" });
  }
});

/* GET NOTIFICATIONS FOR A CHILD */
app.get("/notifications/:childID", async (req, res) => {
  try {
    const { childID } = req.params;
    const parent = await Parent.findOne({ childID });
    if (!parent) return res.json([]);

    const stored = await Notification.find({ childID }).sort({ date: -1 });
    const merged = mergeHistory(generateSchedule(parent.childDOB), parent.vaccinationHistory);
    const derived = buildDerivedScheduleNotifications(parent, merged);

    const fromDb = stored.map(d => notificationDocToStructuredApi(d, parent.childName));
    const keys = new Set(fromDb.map(notifDedupeKey));
    const combined = [...fromDb];
    for (const d of derived) {
      const k = notifDedupeKey(d);
      if (!keys.has(k)) {
        combined.push(d);
        keys.add(k);
      }
    }
    combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(combined);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching notifications" });
  }
});

/* UPDATE APPOINTMENT STATUS */
app.put("/vaccinator/appointment/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const appointment = await Appointment.findByIdAndUpdate(req.params.id, { status }, { new: true });
    res.json({ message: "Status updated successfully", appointment });
  } catch (err) {
    res.status(500).json({ message: "Error updating appointment status" });
  }
});

/* ONSITE REGISTRATION API */
app.post("/vaccinator/onsite-register", async (req, res) => {
  try {
    const { childName, childDOB, parentName, phone, address, vaccineName, centerId } = req.body || {};
    const cleanPhone = String(phone || "").trim();
    const cleanChild = String(childName || "").trim();
    if (!cleanChild || !cleanPhone || !vaccineName || !centerId) {
      return res.status(400).json({ message: "childName, phone, vaccineName, centerId are required" });
    }
    if (cleanPhone.length < 10) {
      return res.status(400).json({ message: "Please enter a valid phone number" });
    }

    let parent = await Parent.findOne({ phone: cleanPhone, childName: cleanChild });

    if (!parent) {
      const childID = String(
        Math.abs(
          (cleanChild + cleanPhone)
            .split("")
            .reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0)
        ) % 90000 + 10000
      );

      parent = new Parent({
        parentName: String(parentName || "").trim(),
        phone: cleanPhone,
        address: String(address || "").trim(),
        childName: cleanChild,
        childDOB: childDOB || "",
        childID
      });
      await parent.save();
    } else if (parentName) parent.parentName = parentName;
    if (address && !parent.address) parent.address = address;
    if (childDOB && !parent.childDOB) parent.childDOB = childDOB;

    const center = await Center.findOne({ centerId });
    const hospitalName = center?.name || centerId;
    const hospitalAddress = center?.address || "";

    const doseNumber = getDoseNumberForVaccine(parent.childDOB, vaccineName);
    const visitTime = new Date();

    upsertVaccinationRecord(parent, vaccineName, doseNumber, {
      status: "completed",
      dateTaken: visitTime,
      hospital: hospitalName,
      hospitalAddress,
      centerId,
      arrivedToday: true,
      visitDate: visitTime
    });

    await parent.save();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newAppt = new Appointment({
      childName: parent.childName,
      childID: parent.childID,
      parentPhone: parent.phone,
      vaccineName,
      doseNumber,
      appointmentDate: today,
      hospital: hospitalName,
      hospitalAddress,
      centerId,
      status: "completed",
      type: "onsite"
    });

    await newAppt.save();

    res.json({ message: "Walk-in registered and vaccination recorded", childID: parent.childID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error registering onsite" });
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
    const arrived =
      req.body?.arrived === true ||
      req.body?.arrived === "true" ||
      req.body?.arrived === 1 ||
      req.body?.arrived === "1";
    const explicitFalse =
      req.body?.arrived === false ||
      req.body?.arrived === "false" ||
      req.body?.arrived === 0 ||
      req.body?.arrived === "0";
    const arrivedFinal = explicitFalse ? false : arrived;

    const parent = await Parent.findOne({ childID });
    if (!parent) return res.status(404).json({ message: "Child not found" });

    const decodedName = decodeURIComponent(vaccineName);
    const record = upsertVaccinationRecord(parent, decodedName, doseNumber, {});
    record.arrivedToday = arrivedFinal;
    if (arrivedFinal) {
      record.visitDate = new Date();
    } else {
      record.visitDate = null;
    }

    await parent.save();
    res.json({ message: "Arrival status updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating arrival status" });
  }
});


/* MARK COMPLETED */
app.put("/vaccination/complete/:childID/:vaccineName/:doseNumber", async (req, res) => {
  try {
    const { childID, vaccineName, doseNumber } = req.params;
    const { centerId, hospital, vaccinatorName } = req.body || {};
    const decodedName = decodeURIComponent(vaccineName);

    const parent = await Parent.findOne({ childID });
    if (!parent) return res.status(404).json({ message: "Child not found" });

    parent.vaccinationHistory = parent.vaccinationHistory.filter(
      (v, i, arr) =>
        arr.findIndex(x =>
          x.vaccineName === v.vaccineName &&
          Number(x.doseNumber) === Number(v.doseNumber)
        ) === i
    );

    const taken = new Date();

    const certId = `VACC-2026-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString().slice(-4)}`;
    const verifyBase = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host") || "localhost:3000"}`;
    const verifyUrl = `${verifyBase}/verify.html?id=${certId}`;
    let qrCodeBase64 = "";
    try {
      qrCodeBase64 = await QRCode.toDataURL(verifyUrl);
    } catch (e) {
      console.error("QR Code Error:", e);
    }

    const record = upsertVaccinationRecord(parent, decodedName, doseNumber, {
      status: "completed",
      dateTaken: taken,
      certificateId: certId,
      issuedAt: taken,
      qrCode: qrCodeBase64,
      vaccinatorName: vaccinatorName || ""
    });
    if (centerId) record.centerId = centerId;
    if (hospital) record.hospital = hospital;

    const apptQ = {
      childID,
      vaccineName: decodedName,
      status: { $nin: ["completed", "rejected"] }
    };
    if (centerId) apptQ.centerId = centerId;
    await Appointment.updateMany(apptQ, { $set: { status: "completed" } });

    await parent.save();
    res.json({ message: "Vaccination marked completed" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error marking vaccination complete" });
  }
});
/* GET VERIFY DIGITAL CERTIFICATE */
app.get("/api/verify/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const parent = await Parent.findOne({ "vaccinationHistory.certificateId": id });
    if (!parent) return res.status(404).json({ message: "Invalid Certificate" });

    const vaccineRecord = parent.vaccinationHistory.find(v => v.certificateId === id);
    if (!vaccineRecord) return res.status(404).json({ message: "Invalid Certificate" });

    res.json({
      verified: true,
      childName: parent.childName,
      parentName: parent.parentName,
      vaccineName: vaccineRecord.vaccineName,
      date: vaccineRecord.dateTaken,
      hospital: vaccineRecord.hospital,
      vaccinator: vaccineRecord.vaccinatorName || "Authorized Vaccinator",
      certificateId: vaccineRecord.certificateId,
      issuedAt: vaccineRecord.issuedAt,
      qrCode: vaccineRecord.qrCode
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error verifying certificate" });
  }
});

/* UNMARK COMPLETED */
app.put("/vaccination/uncomplete/:childID/:vaccineName/:doseNumber", async (req, res) => {
  try {
    const { childID, vaccineName, doseNumber } = req.params;
    const decodedName = decodeURIComponent(vaccineName);
    const parent = await Parent.findOne({ childID });
    if (!parent) return res.status(404).json({ message: "Child not found" });

    let record = parent.vaccinationHistory.find(v => v.vaccineName === decodedName && Number(v.doseNumber) === Number(doseNumber));
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
    const { newDate } = req.body || {};
    const decodedName = decodeURIComponent(vaccineName);
    const parent = await Parent.findOne({ childID });
    if (!parent) return res.status(404).json({ message: "Child not found" });

    const record = upsertVaccinationRecord(parent, decodedName, doseNumber, {});
    record.scheduledDate = new Date(newDate);
    record.status = "scheduled";
    record.dateTaken = null;

    await parent.save();
    res.json({ message: "Vaccination rescheduled" });
  } catch (err) {
    console.error(err);
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
            hospitalName: v.hospital || p.hospital || "",
            centerId: v.centerId || "",
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
// (removed duplicate /vaccinator/send-reminder implementation)

/* ================= QR + OTP CHILD ACCESS (VACCINATOR) — register BEFORE listen in source order ================= */
app.post("/generate-qr-token", async (req, res) => {
  try {
    const { childID, origin } = req.body || {};
    if (!childID) return res.status(400).json({ message: "childID is required" });
    const parent = await Parent.findOne({ childID });
    if (!parent) return res.status(404).json({ message: "Child not found" });
    const secret = await ensureQrSecret(parent);
    const base =
      String(origin || "").trim() ||
      process.env.PUBLIC_BASE_URL ||
      process.env.FRONTEND_URL ||
      "http://localhost:3000";
    const verify_url = buildVerifyQrUrl(base, childID, secret);
    res.json({
      token: secret,
      verify_url,
      childID,
      expiresInSec: null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error generating token" });
  }
});

app.post("/verify-child-access", async (req, res) => {
  try {
    const { childID, token, vaccinatorID } = req.body || {};
    if (!vaccinatorID) return res.status(400).json({ message: "vaccinatorID is required" });

    let resolvedChildID = childID ? String(childID).trim() : null;
    let tokenValid = false;

    if (token) {
      const rec = qrTokenStore[token];
      if (rec && rec.exp >= Date.now()) {
        resolvedChildID = rec.childID;
        tokenValid = true;
      } else {
        const bySecret = await Parent.findOne({ qrSecret: token });
        if (bySecret) {
          if (resolvedChildID && String(resolvedChildID) !== String(bySecret.childID)) {
            return res.status(400).json({ message: "QR data mismatch" });
          }
          resolvedChildID = bySecret.childID;
          tokenValid = true;
        }
      }
      if (!tokenValid) {
        return res.status(400).json({ message: "Invalid or expired QR token" });
      }
    }

    if (!resolvedChildID) {
      return res.status(400).json({ message: "childID or token is required" });
    }

    const vaccinator = await Vaccinator.findOne({ vaccinatorID });
    if (!vaccinator) return res.status(404).json({ message: "Vaccinator not found" });

    const parent = await Parent.findOne({ childID: resolvedChildID });
    if (!parent) return res.status(404).json({ message: "Child not found" });
    if (!parent.email) return res.status(400).json({ message: "Parent email not on file" });

    const otp = Math.floor(100000 + Math.random() * 900000);
    const key = `${resolvedChildID}:${vaccinatorID}`;
    vaccinatorAccessOtpStore[key] = { otp, exp: Date.now() + 10 * 60 * 1000 };

    await transporter.sendMail({
      from: "hospitrack58@gmail.com",
      to: parent.email,
      subject: "VacciLink — verify vaccinator access",
      text: `Your OTP for vaccinator access to ${parent.childName}'s record is: ${otp}\nValid for 10 minutes.`
    });

    res.json({ message: "OTP sent to parent email", childID: resolvedChildID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error requesting access" });
  }
});

app.post("/verify-otp-access", async (req, res) => {
  try {
    const { childID, otp, vaccinatorID } = req.body || {};
    if (!childID || !otp || !vaccinatorID) {
      return res.status(400).json({ access: false, message: "childID, otp, and vaccinatorID are required" });
    }
    const key = `${childID}:${vaccinatorID}`;
    const rec = vaccinatorAccessOtpStore[key];
    if (!rec || rec.exp < Date.now() || String(rec.otp) !== String(otp)) {
      return res.status(400).json({ access: false, message: "Invalid or expired OTP" });
    }
    delete vaccinatorAccessOtpStore[key];

    const parent = await Parent.findOne({ childID });
    if (!parent) return res.status(404).json({ access: false, message: "Child not found" });

    const schedule = generateSchedule(parent.childDOB);
    const merged = mergeHistory(schedule, parent.vaccinationHistory);

    res.json({
      access: true,
      childData: {
        childName: parent.childName,
        childID: parent.childID,
        parentName: parent.parentName,
        parentPhone: parent.phone,
        vaccinationHistory: merged
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ access: false, message: "Verification error" });
  }
});

app.put("/vaccinator/update-vaccination", async (req, res) => {
  try {
    const { childID, vaccineName, doseNumber, dateTaken, status, hospital, centerId, vaccinatorID } = req.body || {};
    if (!childID || !vaccineName || doseNumber == null || !vaccinatorID) {
      return res.status(400).json({ message: "childID, vaccineName, doseNumber, vaccinatorID are required" });
    }
    const vaccinator = await Vaccinator.findOne({ vaccinatorID });
    if (!vaccinator) return res.status(403).json({ message: "Invalid vaccinator" });

    const parent = await Parent.findOne({ childID });
    if (!parent) return res.status(404).json({ message: "Child not found" });

    const record = upsertVaccinationRecord(parent, vaccineName, doseNumber, {});
    if (dateTaken !== undefined && dateTaken !== null && dateTaken !== "") {
      record.dateTaken = new Date(dateTaken);
    }
    if (status) record.status = status;
    if (hospital !== undefined) record.hospital = hospital;
    if (centerId !== undefined) record.centerId = centerId;
    record.updatedByVaccinator = true;
    record.vaccinatorID = vaccinatorID;
    record.updatedAt = new Date();

    await parent.save();
    res.json({ message: "Vaccination updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating vaccination" });
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
  designation: String,
  centerId: String
});

const Vaccinator = mongoose.model("Vaccinator", vaccinatorSchema);

/* ================= REGISTER ================= */

app.post("/vaccinator/register", async (req, res) => {
  try {

    const { fullName, email, phone, password, vaccinatorID, designation, centerId } = req.body;

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
      designation,
      centerId
    });

    await newVaccinator.save();

    res.json({ message: "Registered successfully!" });

  } catch (err) {
    console.log(err);
    res.json({ message: "Error in registration" });
  }
});

/* ================= VACCINATOR LOGIN ================= */

app.post("/vaccinator/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log("LOGIN INPUT:", email, password);

    const vaccinator = await Vaccinator.findOne({ email });
    console.log("FOUND USER:", vaccinator);

    if (!vaccinator) {
      return res.json({ message: "User not found ❌" });
    }

    const isMatch = await bcrypt.compare(password, vaccinator.password);
    console.log("PASSWORD MATCH:", isMatch);

    if (!isMatch) {
      return res.json({ message: "Wrong password ❌" });
    }

    res.json({
      message: "Login successful",
      vaccinator: {
        fullName: vaccinator.fullName,
        email: vaccinator.email,
        centerId: vaccinator.centerId,
        vaccinatorID: vaccinator.vaccinatorID || ""
      }
    });

  } catch (err) {
    console.log(err);
    res.json({ message: "Error logging in" });
  }
});

/* ================= VACCINATOR PROFILE (DYNAMIC) ================= */
app.get("/vaccinator/profile/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const vaccinator = await Vaccinator.findOne({ email });
    if (!vaccinator) return res.status(404).json({ message: "Vaccinator not found" });

    const center = vaccinator.centerId ? await Center.findOne({ centerId: vaccinator.centerId }) : null;

    res.json({
      fullName: vaccinator.fullName || "",
      email: vaccinator.email || "",
      phone: vaccinator.phone || "",
      vaccinatorID: vaccinator.vaccinatorID || "",
      designation: vaccinator.designation || "",
      centerId: vaccinator.centerId || "",
      centerName: center?.name || ""
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching vaccinator profile" });
  }
});

/* ================= VACCINATOR SUMMARY (DYNAMIC) ================= */
app.get("/vaccinator/summary/:centerId", async (req, res) => {
  try {
    const { centerId } = req.params;
    const completed = await Appointment.find({ centerId, status: "completed" }).sort({ appointmentDate: -1 });
    const totalSessionsConducted = completed.length;
    const totalChildrenVaccinated = new Set(completed.map(a => a.childID).filter(Boolean)).size;
    const lastSessionDate = completed.length ? completed[0].appointmentDate : null;

    res.json({
      totalSessionsConducted,
      totalChildrenVaccinated,
      lastSessionDate
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching vaccinator summary" });
  }
});

/* ================= LAST 5 VACCINATION SESSIONS ================= */
app.get("/vaccinator/recent-sessions/:centerId", async (req, res) => {
  try {
    const { centerId } = req.params;
    const items = await Appointment.find({ centerId, status: "completed" })
      .sort({ appointmentDate: -1 })
      .limit(5);

    res.json(items.map(a => ({
      childName: a.childName || "",
      vaccineName: a.vaccineName || "",
      date: a.appointmentDate || null
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching recent sessions" });
  }
});