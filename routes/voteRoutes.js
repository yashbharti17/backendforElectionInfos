const express = require("express");
const router = express.Router();
const Vote = require("../models/voteModel");

// ✅ Fetch All State Votes
router.get("/votes", async (req, res) => {
  try {
    const votes = await Vote.find();
    res.json(votes);
  } catch (error) {
    res.status(500).json({ message: "Error fetching votes", error });
  }
});

// ✅ Fetch Votes for a Specific State
router.get("/votes/:state", async (req, res) => {
  try {
    const vote = await Vote.findOne({ state: req.params.state });
    res.json(vote || { state: req.params.state, PartyA: 0, PartyB: 0 });
  } catch (error) {
    res.status(500).json({ message: "Error fetching state votes", error });
  }
});

// ✅ Cast a Vote for a State
router.post("/vote", async (req, res) => {
  const { state, party } = req.body;

  if (!state || !party) {
    return res.status(400).json({ message: "State and party are required" });
  }

  try {
    let vote = await Vote.findOne({ state });

    if (!vote) {
      vote = new Vote({ state, PartyA: 0, PartyB: 0 });
    }

    vote[party] += 1; // Increment vote count
    await vote.save();

    res.json({ message: "Vote counted!", vote });
  } catch (error) {
    res.status(500).json({ message: "Error updating votes", error });
  }
});

module.exports = router;
