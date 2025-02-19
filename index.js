require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Middleware
app.use(cors({ origin: "*" })); // Allow requests from any frontend
app.use(express.json());

// ✅ Environment Variables
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || "yourSecretKey";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
const FEC_API_KEY = process.env.FEC_API_KEY;
const GOOGLE_CIVIC_API_KEY = process.env.GOOGLE_CIVIC_API_KEY;

// ✅ Connect to MongoDB with Improved Error Handling
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => {
    console.error("❌ MongoDB Connection Failed:", err);
    process.exit(1); // Exit process if connection fails
  });

// ✅ User Schema & Model
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});
const User = mongoose.model("User", UserSchema);

// ✅ Voting Schema & Model
const VoteSchema = new mongoose.Schema({
  state: { type: String, required: true, unique: true },
  PartyA: { type: Number, default: 0 },
  PartyB: { type: Number, default: 0 }
});
const Vote = mongoose.model("Vote", VoteSchema);

// ✅ Middleware to Verify JWT Token
const verifyToken = (req, res, next) => {
  const token = req.header("Authorization");
  if (!token) return res.status(401).json({ message: "Access Denied. No token provided." });

  try {
    const decoded = jwt.verify(token.replace("Bearer ", ""), JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid Token" });
  }
};

// ✅ Auto-Create a Test User (Run Once)
const createTestUser = async () => {
  try {
    const existingUser = await User.findOne({ email: "test@example.com" });
    if (!existingUser) {
      const hashedPassword = await bcrypt.hash("Test@123", 10);
      await new User({ email: "test@example.com", password: hashedPassword }).save();
      console.log("✅ Test user created: test@example.com / Test@123");
    } else {
      console.log("ℹ️ Test user already exists.");
    }
  } catch (error) {
    console.error("❌ Error creating test user:", error);
  }
};
createTestUser();

// ✅ User Registration
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;
  try {
    if (await User.findOne({ email })) return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    await new User({ email, password: hashedPassword }).save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("❌ Registration Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ User Login
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.status(200).json({ message: "Login successful", token, user: { email: user.email } });
  } catch (error) {
    console.error("❌ Login Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Fetch Election Results (FEC API)
app.get("/api/election-results/:year/:office/:state?/:district?", async (req, res) => {
  const { year, office, state, district } = req.params;
  if (!["house", "senate", "president"].includes(office)) {
    return res.status(400).json({ error: "Invalid office type. Use 'house', 'senate', or 'president'." });
  }

  let url = `https://api.open.fec.gov/v1/elections/?cycle=${year}&office=${office}&api_key=${FEC_API_KEY}`;
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

// ✅ Fetch Voter Info (Google Civic API)
app.get("/api/voter-info/:address", async (req, res) => {
  const { address } = req.params;
  const url = `https://civicinfo.googleapis.com/civicinfo/v2/voterinfo?address=${encodeURIComponent(address)}&electionId=2000&key=${GOOGLE_CIVIC_API_KEY}`;

  try {
    const response = await axios.get(url);
    res.json(response.data);
  } catch (error) {
    console.error("❌ Voter Info API Error:", error.message);
    res.status(500).json({ error: "Failed to fetch voter information." });
  }
});

// ✅ Store and Retrieve Votes
app.get("/api/votes", async (req, res) => {
  try {
    const votes = await Vote.find();
    res.json(votes);
  } catch (error) {
    res.status(500).json({ message: "Error fetching votes", error });
  }
});

app.post("/api/vote", async (req, res) => {
  const { state, party } = req.body;
  if (!state || !party) return res.status(400).json({ message: "State and party are required" });

  try {
    let vote = await Vote.findOne({ state });
    if (!vote) vote = new Vote({ state, PartyA: 0, PartyB: 0 });

    vote[party] += 1;
    await vote.save();

    res.json({ message: "Vote counted!", vote });
  } catch (error) {
    res.status(500).json({ message: "Error updating votes", error });
  }
});

app.get("/api/votes/:state", async (req, res) => {
  try {
    const stateName = req.params.state;
    const vote = await Vote.findOne({ state: stateName });

    if (!vote) {
      return res.json({ state: stateName, PartyA: 0, PartyB: 0 });
    }

    res.json(vote);
  } catch (error) {
    console.error("Error fetching state votes:", error);
    res.status(500).json({ message: "Error fetching votes", error });
  }
});

// ✅ Fetch Protected User Profile
app.get("/api/user-profile", verifyToken, (req, res) => {
  res.json({ message: "User Profile Data", user: req.user });
});

// ✅ Start Backend Server
app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
});
