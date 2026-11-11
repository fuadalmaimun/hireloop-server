import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config"; // for esm

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You succssfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.log(err);
  }
}

const connectedClient = await connectToMongoDB();
const db = connectedClient.db("hireloop");
const users = db.collection("user");
const jobs = db.collection("jobs");
const applications = db.collection("applications");

app.get("/", (req, res) => {
  res.send("Hireloop Server is running!");
});

app.get("/users", async (req, res) => {
  const cursor = users.find({});
  const result = await cursor.toArray();
  res.send(result);
});

// get jobs from the database & query filter

app.get("/jobs", async (req, res) => {
  const query = {};

  if (req.query.jobType) {
    query.jobType = req.query.jobType;
  }

  if (req.query.workplaceType) {
    query.workplaceType = req.query.workplaceType;
  }

  if (req.query.experienceLevel) {
    query.experienceLevel = req.query.experienceLevel;
  }

  if (req.query.location) {
    query.location = req.query.location;
  }

  if (req.query.search) {
    const search = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    query.$or = [
      { jobTitle: { $regex: search, $options: "i" } },
      { companyName: { $regex: search, $options: "i" } },
    ];
  }

  const result = await jobs.find(query).toArray();

  res.send(result);
});

// insert a new job
app.post("/jobs", async (req, res) => {
  const job = req.body;
  const result = await jobs.insertOne(job);
  res.send(result);
});

app.delete("/jobs/:id", async (req, res) => {
  const id = req.params.id;
  const result = await jobs.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

app.put("/jobs/:id", async (req, res) => {
  const id = req.params.id;
  const updatedJob = req.body;

  const result = await jobs.updateOne(
    { _id: new ObjectId(id) },
    { $set: updatedJob },
  );

  res.send(result);
});

app.get("/jobs/:id", async (req, res) => {
  const id = req.params.id;

  const result = await jobs.findOne({
    _id: new ObjectId(id),
  });

  if (!result) {
    return res.status(404).send({
      message: "Job not found",
    });
  }

  res.send(result);
});

// apply to a job — one application per seeker per job;
app.post("/applications", async (req, res) => {
  const application = req.body;

  const result = await applications.insertOne(application);

  res.send(result);
});

app.get("/applications", async (req, res) => {
  const query = {};

  if (req.query.userId) {
    query.applicantId = req.query.userId;
  }

  const result = await applications.find(query).toArray();

  res.send(result);
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
