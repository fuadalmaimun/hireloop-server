import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config"; // for esm
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 8000;

// middleware
app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI);

// custom middleware
const myLogger = (req, res, next) => {
  console.log("now hitting api", req.url, req.headers);
  next();
};

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
const sessions = db.collection("session");
const jobs = db.collection("jobs");
const applications = db.collection("applications");
const payments = db.collection("payments");

app.get("/", (req, res) => {
  res.send("Hireloop Server is running!");
});

// jwt
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "No Auth Header" });
  }

  const token = authHeader.split(" ")[1];

  const sessionData = await sessions.findOne({ token });
  if (!sessionData) {
    return res.status(401).send({ message: "Session Not Found" });
  }
  const user = await users.findOne({
    _id: sessionData.userId,
  });

  if (!user) {
    return res.status(401).send({ message: "User Not Found" });
  }

  req.user = user;
  next();
};

// must call this middleware after verifyToken
const verifySeeker = async (req, res, next) => {
  if (req.user.role !== "seeker") {
    res.status(403).send({ message: "Forbidden" });
    return;
  }
  next();
};
const verifyRecruiter = async (req, res, next) => {
  if (req.user.role !== "recruiter") {
    res.status(403).send({ message: "Forbidden" });
    return;
  }
  next();
};

const verifyAdmin = async (req, res, next) => {
  if (req.user.role !== "admin") {
    res.status(403).send({ message: "Forbidden" });
    return;
  }
  next();
};

// users related api
app.get("/users", async (req, res) => {
  const cursor = users.find({});
  const result = await cursor.toArray();
  res.send(result);
});

app.get("/users/:id/premium", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await users.findOne(query, { projection: { premium: 1 } });
  res.send(result);
});

app.patch("/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };

  const updatedDocs = {
    $set: {
      role: req.body.role,
    },
  };

  const result = await users.updateOne(query, updatedDocs);
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
  if (req.query.recruiterId) {
    query.recruiterId = req.query.recruiterId;
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
app.post("/jobs", verifyToken, verifyRecruiter, async (req, res) => {
  const { recruiterId } = req.body;
  const recruiter = await users.findOne({
    _id: recruiterId,
  });
  const jobCount = await jobs.countDocuments({
    recruiterId,
  });

  if (!recruiter?.premium && jobCount >= 9) {
    return res.status(403).send({
      success: false,
      message: "Free plan allows only 9 job postings. Upgrade to Premium.",
    });
  }

  const job = {
    ...req.body,
    recruiterId,
  };
  const result = await jobs.insertOne(job);

  res.send({
    success: true,
    insertedId: result.insertedId,
  });
});

// validate a Mongo id up-front so a bad request can't crash the handlers
const toObjectId = (id) => {
  if (!ObjectId.isValid(id)) return null;
  return new ObjectId(id);
};

app.delete("/jobs/:id", async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) return res.status(404).send({ error: "Job not found" });
  const result = await jobs.deleteOne({ _id });
  res.send(result);
});

app.put("/jobs/:id", async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) return res.status(404).send({ error: "Job not found" });
  const updatedJob = req.body;

  const result = await jobs.updateOne({ _id }, { $set: updatedJob });

  res.send(result);
});

app.get("/jobs/:id", async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) return res.status(404).send({ error: "Job not found" });
  const result = await jobs.findOne({ _id });
  if (!result) return res.status(404).send({ error: "Job not found" });
  res.send(result);
});

// apply to a job — one application per seeker per job;
app.post("/applications", verifyToken, verifySeeker, async (req, res) => {
  const application = req.body;
  const result = await applications.insertOne(application);
  res.send(result);
});

app.patch("/applications/:id", async (req, res) => {
  console.log("PATCH route hit:", req.params.id);

  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const updatedDocs = {
    $set: {
      status: req.body.status,
    },
  };
  const result = await applications.updateOne(query, updatedDocs);

  res.send(result);
});

app.get("/applications", verifyToken, async (req, res) => {
  const query = {};

  const applicantId = req.query.applicantId;
  const jobId = req.query.jobId;

  if (applicantId) {
    query.applicantId = applicantId;
  }

  if (jobId) {
    const jobQuery = { _id: new ObjectId(jobId) };
    const job = await findOne(jobQuery);
    if (
      job.recruiterId !== req.user._id.toString() &&
      req.user.role !== "admin"
    ) {
      res.status(403).send({ message: "Forbidden" });
      return;
    }

    query.jobId = jobId;
  }

  const result = await applications.find(query).toArray();
  res.send(result);
});
app.get("/applications/count", async (req, res) => {
  const query = {};
  if (req.query.applicantId) {
    query.applicantId = req.query.applicantId;
  }
  const result = await applications.countDocuments(query);
  res.send({ count: result });
});

app.post("/payments/checkout-verify", async (req, res) => {
  const { sessionId } = req.body;

  const { status, payment_status, customer_email, metadata, payment_intent } =
    await stripe.checkout.sessions.retrieve(sessionId);

  // 1. is used new session
  // 2. check is the session id for the currently logged in user
  // 3. insert sessionId in to the payment collection
  // 4. update user information as premium user
  if (status === "complete" && payment_status === "paid") {
    const sessionQuery = { sessionId };
    const existingPayment = await payments.findOne(sessionQuery);
    if (existingPayment) {
      return res.send({ success: false, massage: "Payment already verified" });
    }

    const payment = {
      sessionId,
      status,
      payment_status,
      customer_email,
      userId: metadata.userId,
      payment_intent,
    };
    const result = await payments.insertOne(payment);

    // update the user table
    const query = { _id: new ObjectId(metadata.userId) };
    const updatedDocs = {
      $set: { premium: true },
    };
    const updateResult = await users.updateOne(query, updatedDocs);
    res.send({ success: true, result, updateResult });
    return;
  }

  res.send({ success: false, message: "Payment verification failed" });
  return;
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
