const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config()
const stripe = require('stripe')(process.env.PAYMENT_SECRET)
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 5000;


app.use(express.json());
app.use(cors())


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jki4viv.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

//Verify jwt token 

const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' });
    }
    const token = authorization.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next();
    })
}


async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const usersCollection = client.db('assignment-12').collection('users');
        const classCollection = client.db('assignment-12').collection('class');
        const selectCollection = client.db('assignment-12').collection('selectedClass');
        const enrollCollection = client.db('assignment-12').collection('enrollClass');
        const paymentCollection = client.db('assignment-12').collection('payments');

        const verifyAdmin = async(req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden message' });
            }
            next();
        }
        const verifyInstructor = async(req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user.role !== 'instructor') {
                return res.status(403).send({ error: true, message: 'forbidden message' });
            }
            next();
        }
        app.post('/jwt_token', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN, { expiresIn: '10h' })
            res.send({ token })
        })

        app.get('/users', verifyJWT, verifyAdmin, async(req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result)
        })
        app.get('/user_role/:email', verifyJWT, async(req, res) => {
            const email = req.params.email;
            const query = { email: email }
            const result = await usersCollection.findOne(query);
            res.send({ role: result?.role })
        })
        app.post('/users', async(req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existUser = await usersCollection.findOne(query)
            if (existUser) {
                return res.send({ message: 'User Already exist' })
            }
            const result = await usersCollection.insertOne(user);
            res.send(result)
        })
        app.get('/my_class/:email', verifyJWT, verifyInstructor, async(req, res) => {
            const email = req.params.email;
            const query = { email: email }
            const result = await classCollection.find(query).toArray();
            res.send(result)
        })
        app.get('/all_class', async(req, res) => {
            const result = await classCollection.find({ status: 'approved' }).toArray();
            res.send(result)
        })
        app.get('/get_six_instructor', async(req, res) => {
            const result = await usersCollection.find({ role: 'instructor' }).limit(6).toArray();
            res.send(result)
        })
        app.get('/get_all_instructors', async(req, res) => {
            const result = await usersCollection.find({ role: 'instructor' }).toArray();
            res.send(result)
        })
        app.get('/class_is_selected_or_enrolled/:email/:id', verifyJWT, async(req, res) => {
            const email = req.params.email;
            const id = req.params.id;
            const result = await selectCollection.findOne({ classId: id, email: email });
            const resultenrolled = await enrollCollection.findOne({ classId: id, email: email });
            if (result && resultenrolled) {
                res.send({ isSelected: true, isEnrolled: true })
            } else if (result && !resultenrolled) {
                res.send({ isSelected: true, isEnrolled: false })
            } else if (!result && resultenrolled) {
                res.send({ isSelected: false, isEnrolled: true })
            } else if (!result && !resultenrolled) {
                res.send({ isSelected: false, isEnrolled: false })
            }

        })
        app.post('/add_class', verifyJWT, verifyInstructor, async(req, res) => {
            const class_data = req.body;
            const query = { email: class_data.email }
            const findUser = await usersCollection.findOne(query)

            const result = await classCollection.insertOne({...class_data, authorId: findUser._id });
            res.send(result)
        })

        //Admin Route
        app.get('/all_classes_admin', verifyJWT, verifyAdmin, async(req, res) => {
            const result = await classCollection.find().toArray();
            res.send(result)
        })
        app.patch('/change_status/:id', verifyJWT, verifyAdmin, async(req, res) => {
            const id = req.params.id;
            const status = req.query.status
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: status
                },
            };

            const result = await classCollection.updateOne(filter, updateDoc);

            res.send(result)
        })
        app.patch('/sendfeedback/:id', verifyJWT, verifyAdmin, async(req, res) => {
                const id = req.params.id;
                const feedback = req.body?.feedback
                const filter = { _id: new ObjectId(id) };
                const updateDoc = {
                    $set: {
                        feedback: feedback
                    },
                };
                const result = await classCollection.updateOne(filter, updateDoc);
                res.send(result)
            })
            //Student Route
        app.get('/my_selected_class/:email', verifyJWT, async(req, res) => {
            const email = req.params.email;
            const pipeline = [{
                    $match: { email }
                },
                {
                    $lookup: {
                        from: 'class',
                        let: { classId: { $toObjectId: '$classId' } },
                        pipeline: [{
                            $match: {
                                $expr: { $eq: ['$_id', '$$classId'] }
                            }
                        }],
                        as: 'course'
                    }
                },
                {
                    $unwind: '$course'
                }
            ];
            const result = await selectCollection.aggregate(pipeline).toArray();
            res.send(result);

        })
        app.get('/my_enrolled_class/:email', verifyJWT, async(req, res) => {
            const email = req.params.email;
            const result = await enrollCollection.find({ email: email }).toArray();
            res.send(result);

        })
        app.get('/payment_history/:email', verifyJWT, async(req, res) => {
            const email = req.params.email;
            const result = await paymentCollection.find({ email: email }).sort({ $natural: -1 }).toArray();
            res.send(result);

        })
        app.delete('/selected_class/:id', verifyJWT, async(req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await selectCollection.deleteOne(query);
            res.send(result);

        })


        app.post('/select_class', verifyJWT, async(req, res) => {
            const class_details = req.body;

            const result = await selectCollection.insertOne(class_details);
            res.send(result)
        })
        app.get('/class_enroll/:id', verifyJWT, async(req, res) => {
            const id = req.params.id;
            const selectedClassId = new ObjectId(id)
            const pipeline = [{
                    $match: { _id: selectedClassId }
                },
                {
                    $lookup: {
                        from: 'class',
                        let: { classId: { $toObjectId: '$classId' } },
                        pipeline: [{
                            $match: {
                                $expr: { $eq: ['$_id', '$$classId'] }
                            }
                        }],
                        as: 'course'
                    }
                },
                {
                    $unwind: '$course'
                },
                {
                    $limit: 1
                }
            ];

            const result = await selectCollection.aggregate(pipeline).toArray();
            res.send(result);
        })


        app.patch('/users_manage/:id/:role', verifyJWT, verifyAdmin, async(req, res) => {
            const id = req.params.id;
            const role = req.params.role;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: role
                },
            };

            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);

        })

        //Payment 
        app.post('/create-payment', verifyJWT, async(req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });

            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })

        app.post('/payments', async(req, res) => {
            const payment = req.body;
            const findCourse = await classCollection.findOne({ _id: new ObjectId(payment.course.classId) })

            if (findCourse && findCourse.seats > 0) {
                const query = { _id: new ObjectId(payment.course._id) }
                const deleteResult = await selectCollection.deleteOne(query)
                const findClass = await classCollection.findOne({ _id: new ObjectId(payment.course.classId) })
                delete payment.course._id
                const filter = { _id: new ObjectId(payment.course.classId) };
                const updateDoc = {
                    $set: {
                        seats: parseInt(findClass.seats) - 1
                    },
                };
                const result = await classCollection.updateOne(filter, updateDoc);
                const insertResult = await paymentCollection.insertOne(payment);
                const enrollRsult = await enrollCollection.insertOne(payment.course);
                res.send({ insertResult, enrollRsult, deleteResult, result });
            } else {
                return res.send({ message: 'No Seat Available' })
            }
        })


        app.get('/lts_six_class', async(req, res) => {
            const result = await classCollection.aggregate([{
                    $match: {
                        status: 'approved' // Filter courses with status = "approve"
                    }
                },
                {
                    $lookup: {
                        from: 'enrollClass',
                        let: { classId: { $toString: '$_id' } },
                        pipeline: [{
                            $match: {
                                $expr: {
                                    $eq: ['$classId', '$$classId']
                                }
                            }
                        }],
                        as: 'enrollments'
                    }
                },
                {
                    $addFields: {
                        enrollCount: { $size: '$enrollments' }
                    }
                },
                {
                    $sort: { enrollCount: -1 } // Sorting in ascending order of enrollCount
                },
                {
                    $limit: 6 // Limit the result to 6 courses
                }
            ]).toArray();

            res.json(result);
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send('assignment 12')
})

app.listen(port, () => {
    console.log('Assignment 12....', port)
})