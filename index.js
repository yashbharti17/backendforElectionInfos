const express = require("express");
const axios = require("axios");
const cors = require("cors");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const FEC_API_KEY = process.env.FEC_API_KEY;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || "yourSecretKey";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

// 🔹 Connect to MongoDB
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB Connection Failed:", err));

// 🔹 User Schema & Model
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const User = mongoose.model("User", UserSchema);

// 🔹 Middleware to Verify JWT Token
const verifyToken = (req, res, next) => {
  const token = req.header("Authorization");

  if (!token) {
    return res.status(401).json({ message: "Access Denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(token.replace("Bearer ", ""), JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid Token" });
  }
};

// 🔹 Create a Test User (Run Once)
const createTestUser = async () => {
  const existingUser = await User.findOne({ email: "test@example.com" });
  if (!existingUser) {
    const hashedPassword = await bcrypt.hash("Test@123", 10);
    const user = new User({ email: "test@example.com", password: hashedPassword });
    await user.save();
    console.log("✅ Test user created: test@example.com / Test@123");
  } else {
    console.log("ℹ️ Test user already exists.");
  }
};
createTestUser();

// 🔹 User Registration
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ email, password: hashedPassword });
    await newUser.save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("❌ Registration Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// 🔹 User Login with Debugging Logs
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    console.log("🔍 Checking user:", email);

    const user = await User.findOne({ email });
    if (!user) {
      console.log("❌ User not found");
      return res.status(401).json({ message: "Invalid email or password" });
    }

    console.log("✅ User found, verifying password...");

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("❌ Password incorrect");
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    console.log("✅ Login successful");
    res.status(200).json({ message: "Login successful", token, user: { email: user.email } });
  } catch (error) {
    console.error("❌ Login Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// 🔹 Fetch Election Results (No Authentication Required)
app.get("/api/election-results/:year/:office/:state?/:district?", async (req, res) => {
  const { year, office, state, district } = req.params;
  const validOffices = ["house", "senate", "president"];

  if (!validOffices.includes(office)) {
    return res.status(400).json({ error: "Invalid office type. Use 'house', 'senate', or 'president'." });
  }

  let url = `https://api.open.fec.gov/v1/elections/?cycle=${year}&office=${office}&api_key=${FEC_API_KEY}`;

  if (office === "senate" && !state) {
    return res.status(400).json({ error: "Must include 'state' parameter for Senate elections." });
  }
  if (office === "house" && (!state || !district)) {
    return res.status(400).json({ error: "Must include both 'state' and 'district' parameters for House elections." });
  }

  if (state) url += `&state=${state}`;
  if (district) url += `&district=${district}`;

  try {
    const response = await axios.get(url);
    res.json(response.data);
  } catch (error) {
    console.error("❌ Election Results API Error:", error.message);
    res.status(500).json({ error: "Failed to fetch election results." });
  }
});

// 🔹 Fetch Protected User Profile (Requires JWT Authentication)
app.get("/api/user-profile", verifyToken, (req, res) => {
  res.json({ message: "User Profile Data", user: req.user });
});

// Start Backend Server
app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
});
