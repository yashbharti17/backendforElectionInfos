require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { GoogleGenerativeAI } = require('@google/generative-ai');
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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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
// Expert schema

const ExpertScoreSchema = new mongoose.Schema({
  factor: { type: String, required: true, unique: true },
  expertScoreA: { type: Number, default: 0 },
  expertScoreB: { type: Number, default: 0 },
});

const ExpertScore = mongoose.model("ExpertScore", ExpertScoreSchema);


// Define a schema for storing AI evaluation data
const aiScoreSchema = new mongoose.Schema({
  candidate: { type: String, unique: true }, // Ensures one entry per candidate
  scores: [
    {
      factor: String,
      score: Number,
      justification: String,
    }
  ],
  finalScore: {
    weightedTotalScore: Number,
    finalEvaluation: String,
  },
  updatedAt: { type: Date, default: Date.now },
});

const AIScore = mongoose.model('AIScore', aiScoreSchema);

// Function to generate content using Google Generative AI
async function generateContent(candidateName, partyAffiliation) {
  const genAI = new GoogleGenerativeAI("AIzaSyD5ejUrG1wngCsgrwPR63ZNNnccPibw3p8");
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `
  You are an AI election analyst evaluating a U.S. presidential candidate based on 24 key factors, including their accomplishments, political stance, leadership, and public perception. Your task is to analyze the candidate, assign a score (0-100) for each factor, and provide a brief justification for each score. Finally, calculate the overall weighted score and provide a summary assessment.
  
  Candidate Name: ${candidateName}
  Election Year: 2026
  Party Affiliation: ${partyAffiliation}
  
  Factors and Scoring Criteria:
  Accomplishments: Score (0-100) | Justification
  Age: Score (0-100) | Justification
  Climate: Score (0-100) | Justification
  Believe in America: Score (0-100) | Justification
  Communication Skills (Public Speaking, Debates, etc.): Score (0-100) | Justification
  Economic Success : Score (0-100) | Justification
  Educated : Score (0-100) | Justification
  Experience in political Environment: Score (0-100) | Justification
  Exposure to foreign/Domestic policies: Score (0-100) | Justification
  Family Success: Score (0-100) | Justification
  Freedom of speech supporter: Score (0-100) | Justification
  Has agenda: Score (0-100) | Justification
  Health: Score (0-100) | Justification
  Honesty: Score (0-100) | Justification
  How centric is his policies are: Score (0-100) | Justification
  Lead by example: Score (0-100) | Justification
  Likeability : Score (0-100) | Justification
  Public Health: Score (0-100) | Justification
  Social Success : Score (0-100) | Justification
  Stand on political issues: AI: Score (0-100) | Justification
  Stand on Political Issues: Economy: Score (0-100) | Justification
  Stand on Political Issues: Immigration: Score (0-100) | Justification
  Team approach: Score (0-100) | Justification
  Education Level & Intellectual Rigor: Score (0-100) | Justification
   Please return the evaluation results in **JSON format only**, like this:
  
    {
      "candidate": "${candidateName}",
      "scores": [
        { "factor": "Accomplishments", "score": 85, "justification": "Explanation." },
        { "factor": "Age", "score": 70, "justification": "Explanation." }
      ],
      "finalScore": {
        "weightedTotalScore": 80.5,
        "finalEvaluation": "Summary assessment."
      }
    }
  `;

  try {
    const result = await model.generateContent(prompt);
    const generatedContent = await result.response.text();
    const sanitizedContent = generatedContent.replace(/```[a-z]+\n/, '').replace(/\n```/, '');
    const parsedResult = JSON.parse(sanitizedContent);

    // Update the existing entry or create a new one
    await AIScore.findOneAndUpdate(
      { candidate: parsedResult.candidate }, // Find by candidate name
      {
        scores: parsedResult.scores,
        finalScore: parsedResult.finalScore,
        updatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    console.log(`Data updated for ${parsedResult.candidate}`);
  } catch (error) {
    console.error("Error generating content:", error);
  }
}

// Run the function for two candidates
async function runEvaluation() {
  await generateContent("Donald Trump", "Republican");
  await generateContent("Joe Biden", "Democrat");
}

runEvaluation();


// API route to fetch scores
app.get('/api/scores', async (req, res) => {
  try {
    const scores = await AIScore.find();
    res.json(scores);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch scores" });
  }
});


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
// get score
app.get("/api/expert-scores", async (req, res) => {
  try {
    const scores = await ExpertScore.find();
    res.json(scores);
  } catch (error) {
    console.error("❌ Error fetching expert scores:", error);
    res.status(500).json({ message: "Server error" });
  }
});
// post score
app.post("/api/expert-score", async (req, res) => {
  const { factor, expertScoreA, expertScoreB } = req.body;
  const token = req.header("Authorization");

  if (!token) {
    return res.status(401).json({ message: "Unauthorized. Please log in." });
  }

  try {
    let score = await ExpertScore.findOne({ factor });

    if (score) {
      score.expertScoreA = expertScoreA;
      score.expertScoreB = expertScoreB;
    } else {
      score = new ExpertScore({ factor, expertScoreA, expertScoreB });
    }

    await score.save();
    res.json({ message: "Expert scores updated successfully!", score });
  } catch (error) {
    console.error("❌ Error updating expert score:", error);
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
