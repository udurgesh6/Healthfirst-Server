///////////////////////////////////    All Imports start here    /////////////////////////////////////////////////////


// Basic Imports
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require('cors');
const port = process.env.PORT || 4001;


// Import to access Watson ML APIS
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;


// Imports to store ML outputs of user in firestore
const {firestore} = require('firebase-admin')
const admin = require('firebase-admin')
const serviceAccount = require('./firebase/serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();


// Imports for CRON JOBS
const cronJob = require('cron').CronJob;
const transporter = require('./config')
const dotenv = require('dotenv');
const { CronJob } = require("cron");
dotenv.config();



////////////////////////////////////   All Imports End here     ///////////////////////////////////////////////////////////













//////////////////////////////// Functionality Starts of Sending Data as a fitbit to Phone/////////////////////////////////////



// Using Express Server
const app = express();

// Creating HTTP Server
const server = http.createServer(app);

// Using SocketIO to establish real time connection which is 
// used here to send real time health data to phone in place of fitbit watch
const io = socketIo(server, {
    cors: {                               //using CORS to allow cross origin request
        origin: "http://localhost:19006", //this mentions the web port to which data is to be sent
        methods: ["GET","POST"]           //Request headers to be allowed
    }
});

let interval;

io.on("connection", (socket) => {
  // As soon as th user connects
  console.log("New client connected");
  
  if (interval) {
    clearInterval(interval);
  }

  // Starts using API
  interval = setInterval(() => getApiAndEmit(socket),5 * 1000);

  // As soon as the user disconnects
  socket.on("disconnect", () => {
    console.log("Client disconnected");
    clearInterval(interval);
  });
});

// API sending health data in place of fitbit watch
const getApiAndEmit = socket => {
  const response = {
      date: new Date(),
      oxygen_sat : Math.floor((Math.random() * (15)) + 85),
      body_temp : Math.floor((Math.random() * (8)) + 97),
      high_bp : Math.floor((Math.random() * (40)) + 80),
      low_bp : Math.floor((Math.random() * (30)) + 60),
      respiration : Math.floor((Math.random() * (8)) + 12),
      glucose : Math.floor((Math.random() * (90)) + 50),
      heart_rate : Math.floor((Math.random() * (70)) + 60),
      electro : Math.floor((Math.random() * (80)) + 120),
  }
  // Emitting a new message. Will be consumed by the client
  socket.emit("FromAPI", response);
};


///////////////////////////// Functionality Ends of Sending Data as a Fitbit to Phone  ///////////////////////////////////////














////////////////////////// Jobs Scheduling to Predict Heart Failure and Sending the data to Firestore ///////////////////////////



// This block of code executes a particular job at a mentioned time
const job = new cronJob('32 16 * * *', ()=> {
  console.log("This will get executed at 12:21")

  // Extra Code 1

  // This is your API KEY that you get while you prepare your ML model on IBM related to heart failure
  const API_KEY_HF = "VssWuLZOOUq-zzPpvf_Oz5FX_awMSK9W3_PUsmUJxq3u";

  // This gets your access_token to run the function apiPost
  function getTokenHF(errorCallback, loadCallback) {
    const req = new XMLHttpRequest();
    req.addEventListener("load", loadCallback);
    req.addEventListener("error", errorCallback);
    req.open("POST", "https://iam.cloud.ibm.com/identity/token");
    req.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    req.setRequestHeader("Accept", "application/json");
    req.send("grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=" + API_KEY_HF);
  }

  // This is the function which takes scoring_url => api url
  //                                  token => acess_token from above
  //                                  payload => a input of fields and data
  //                                  loadCallbacl => a function to run
  //                                  errCallback => a function to output error
  function apiPostHF(scoring_url, token, payload, loadCallback, errorCallback){
    const oReq = new XMLHttpRequest();
    oReq.addEventListener("load", loadCallback);
    oReq.addEventListener("error", errorCallback);
    oReq.open("POST", scoring_url);
    oReq.setRequestHeader("Accept", "application/json");
    oReq.setRequestHeader("Authorization", "Bearer " + token);
    oReq.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    oReq.send(payload);
  }


  // Here starts the main run by calling first the getToken function
  getTokenHF((err) => console.log(err), function () {
    let tokenResponse;
    try {
      // this gets the token response
      tokenResponse = JSON.parse(this.responseText);
    } catch(ex) {
      console.log("I am executed")
      // TODO: handle parsing exception
    }
    // NOTE: manually define and pass the array(s) of values to be scored in the next line
    
    const payload = `{"input_data": [{"fields": ["AVGHEARTBEATSPERMIN","PALPITATIONSPERDAY","CHOLESTEROL","BMI","AGE","SEX","FAMILYHISTORY","SMOKERLAST5YRS","EXERCISEMINPERWEEK"], "values": [[80,36,164,31,45,"F","Y","N",141]]}]}`;
    const scoring_url = "https://eu-gb.ml.cloud.ibm.com/ml/v4/deployments/6095eca2-3da3-42e1-aa81-664a96d7741c/predictions?version=2021-02-18";


    // passing the details
    apiPostHF(scoring_url, tokenResponse.access_token, payload, function (resp) {
      let parsedPostResponseHF;
      try {
        parsedPostResponseHF = this.responseText;
      } catch (ex) {
        // TODO: handle parsing exception
      }
      console.log("Scoring response");
      console.log(parsedPostResponseHF);
      const pt = {
        HF : parsedPostResponseHF,
        creation : new Date()
      }
      db.collection('ML Predictions').doc('8bhCmxBNvEfgOBNfc4wTK3XALCa2').collection('Heart Failure').add(pt).then(()=> {
        console.log("New Data stored to Database")
      })
    }, function (error) {
      console.log("Executing: ",error);
    });
  });

})

// Start the job 
job.start();



/////////////////////////   Job Scheduling to generate HF ML report and upload to firebase ends here   ///////////////////////////////














//////////////////Job Scheduling to get the latest HF ML report of user from firestore and then mailing the report starts ///////////////////////////



const job1 = new cronJob('35 16 * * *', () => {
       db
        .collection("ML Predictions")
        .doc("8bhCmxBNvEfgOBNfc4wTK3XALCa2")
        .collection("Heart Failure")
        .orderBy("creation", "asc")
        .limit(1)
        .get()
        .then((snapshot)=> {
            let posts = snapshot.docs.map(doc => {
                const data = doc.data();
                const id = doc.id;
                return{
                    id, ...data
                }
            })

            // Outputs to look after
            // { predictions: [ { fields: [Array], values: [Array] } ] }
            // [ { fields: [ 'prediction', 'probability' ], values: [ [Array] ] } ]
            /*
              {
                fields: [ 'prediction', 'probability' ],
                values: [ [ 'Y', [Array] ] ]
              }
            */
            // console.log(JSON.parse(posts[0].HF).predictions[0].values[0][1])

            try {
              const mailOptions = {
                from: 'udurgesh6@gmail.com',   // This is the email address from where mail is to be sent
                to: 'udurgesh6@gmail.com',     // This the email address of the user who wants the service 
                subject: 'Testing !!!',  
                html:`
                <p>Sending Your Health Predictions</p>
                <h3>HEALTH PREDICTIONS</h3>
                <ul>
                  <li>Heart Failure Prediction: </li>
                    <ul>
                      <li>Prediction: ${JSON.parse(posts[0].HF).predictions[0].values[0][0]}</li>
                      <li>Probability: ${JSON.parse(posts[0].HF).predictions[0].values[0][1][1]}</li>
                    </ul>
                </ul>
                `
              };
          
              transporter.sendMail(mailOptions, function (err, info) {
                if(err){
                  console.log("Message: Something Went Wrong")
                }else{
                  console.log("Test Successful")
                }
              })
            }catch {
              console.log("Something went wrong while catching")
            }

        })

    
})

job1.start();



/////////////////////////////// Jobt to get HF ML predic latest from firestore and mailing to user ends here ////////////////////////////////////














///////////////////////////////////////// Job to predict things for which data are not available ////////////////////////////////////


const job2 = new cronJob('35 19 * * *', () => {
  db.collection('Health Parameters').doc('S2igEB6hhadE6rByOvv0JptMxaV2').collection('Oxygen Saturation').get().then((snapshot)=>{
    let posts = snapshot.docs.map(doc => {
      const data = doc.data();
      const id = doc.id;
      return{
          id, ...data
      }
    })
    total_oxy = 0
    for(let i=0;i<posts.length;i++){
      total_oxy += posts[i].Rate
    }
    avg_oxy = total_oxy/posts.length;

    if(avg_oxy < 95){
      db.collection('ML Predictions').doc('8bhCmxBNvEfgOBNfc4wTK3XALCa2').collection('Hypoxemia').add({Hyp: "Chances of Hypoxemia", creation: new Date()}).then(()=> {
        console.log("New Data stored to Database")
      })
    }else if(avg_oxy > 100){
      db.collection('ML Predictions').doc('8bhCmxBNvEfgOBNfc4wTK3XALCa2').collection('Hypoxemia').add({Hyp: "Chances of Hyperoxemia", creation: new Date()}).then(()=> {
        console.log("New Data stored to Database")
      })
    }else{
      db.collection('ML Predictions').doc('8bhCmxBNvEfgOBNfc4wTK3XALCa2').collection('Hypoxemia').add({Hyp: "Normal", creation: new Date()}).then(()=> {
        console.log("New Data stored to Database")
      })
    }
    
  })
})

job2.start();



///////////////////////////////// Job to predict for which data is'nt available ends here ///////////////////////////////////















////////////////////////////// Job to send Hypoxemia Report as a mail starts /////////////////////////////////////////


const job3 = new CronJob('05 20 * * *',() => {
  db
        .collection("ML Predictions")
        .doc("8bhCmxBNvEfgOBNfc4wTK3XALCa2")
        .collection("Hypoxemia")
        .orderBy("creation", "asc")
        .limit(1)
        .get()
        .then((snapshot)=> {
            let posts = snapshot.docs.map(doc => {
                const data = doc.data();
                const id = doc.id;
                return{
                    id, ...data
                }
            })

            try {
              const mailOptions = {
                from: 'udurgesh6@gmail.com',   // This is the email address from where mail is to be sent
                to: 'udurgesh6@gmail.com',     // This the email address of the user who wants the service 
                subject: 'Testing !!!',  
                html:`
                <p>Sending Your Health Predictions</p>
                <h3>HEALTH PREDICTIONS</h3>
                <ul>
                  <li>Hypoxemia Prediction: </li>
                    <ul>
                      <li>Prediction: ${posts[0].Hyp}</li>
                    </ul>
                </ul>
                `
              };
          
              transporter.sendMail(mailOptions, function (err, info) {
                if(err){
                  console.log("Message: Something Went Wrong")
                }else{
                  console.log("Test Successful")
                }
              })
            }catch {
              console.log("Something went wrong while catching")
            }

        })
})


job3.start()


///////////////////// Getting the latest ML prediction report of Hypoxemia and mailing it ends here   /////////////////////////////

















//////////////////////////////// Job to predict Diabetes and uploading it to the database   /////////////////////////////////////////



const job4 = new CronJob('40 19 * * *',() => {
    const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

    const API_KEY = "fvQL2kOiS5b44DQA3xbT42aZw96PxA97SJaOXC5a6bUQ";

    function getToken(errorCallback, loadCallback) {
      const req = new XMLHttpRequest();
      req.addEventListener("load", loadCallback);
      req.addEventListener("error", errorCallback);
      req.open("POST", "https://iam.cloud.ibm.com/identity/token");
      req.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
      req.setRequestHeader("Accept", "application/json");
      req.send("grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=" + API_KEY);
    }

    function apiPost(scoring_url, token, payload, loadCallback, errorCallback){
      const oReq = new XMLHttpRequest();
      oReq.addEventListener("load", loadCallback);
      oReq.addEventListener("error", errorCallback);
      oReq.open("POST", scoring_url);
      oReq.setRequestHeader("Accept", "application/json");
      oReq.setRequestHeader("Authorization", "Bearer " + token);
      oReq.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
      oReq.send(payload);
    }

    getToken((err) => console.log(err), function () {
      let tokenResponse;
      try {
        tokenResponse = JSON.parse(this.responseText);
      } catch(ex) {
        // TODO: handle parsing exception
      }
      // NOTE: manually define and pass the array(s) of values to be scored in the next line
      const payload = '{"input_data": [{"fields": ["Pregnancies","Glucose","BloodPressure","SkinThickness","Insulin","BMI","DiabetesPedigreeFunction","Age"], "values": [[6,148,72,35,0,33.6,0.627,50]]}]}';
      const scoring_url = "https://eu-gb.ml.cloud.ibm.com/ml/v4/deployments/1bb38984-ebc9-455f-ac63-591384bb1f35/predictions?version=2021-02-20";
      apiPost(scoring_url, tokenResponse.access_token, payload, function (resp) {
        let parsedPostResponse;
        try {
          parsedPostResponse = JSON.parse(this.responseText);
        } catch (ex) {
          // TODO: handle parsing exception
        }
        console.log("Scoring response");
        // [ [ 1, [ 0.36731261014938354, 0.6326873898506165 ] ] ]
        //console.log(parsedPostResponse.predictions[0].values[0][0]);
        let ans;
        if(parsedPostResponse.predictions[0].values[0][0] === 1){
          ans = "Chances of Diabetes"
        }else{
          ans = "No Chance of Diabetes"
        }
        prob = parsedPostResponse.predictions[0].values[0][1][1] * 100
        db.collection('ML Predictions').doc('8bhCmxBNvEfgOBNfc4wTK3XALCa2').collection('Diabetes').add({Prediction: ans, Percentage: prob + '%', creation: new Date()}).then(()=> {
          console.log("New Data stored to Database")
        })
      }, function (error) {
        console.log(error);
      });
    });
})

job4.start();



//////////////////////////////////// Job to predict diabetes and then storing to firestore ends  //////////////////////////////

















//////////////////////////////////// Job to mail the diabetes ML report ////////////////////////////////////////



const job5 = new CronJob('10 20 * * *',() => {
      db
        .collection("ML Predictions")
        .doc("8bhCmxBNvEfgOBNfc4wTK3XALCa2")
        .collection("Diabetes")
        .orderBy("creation", "asc")
        .limit(1)
        .get()
        .then((snapshot)=> {
            let posts = snapshot.docs.map(doc => {
                const data = doc.data();
                const id = doc.id;
                return{
                    id, ...data
                }
            })

            try {
              const mailOptions = {
                from: 'udurgesh6@gmail.com',   // This is the email address from where mail is to be sent
                to: 'udurgesh6@gmail.com',     // This the email address of the user who wants the service 
                subject: 'Testing !!!',  
                html:`
                <p>Sending Your Health Predictions</p>
                <h3>HEALTH PREDICTIONS</h3>
                <ul>
                  <li>Diabetes Prediction: </li>
                    <ul>
                      <li>Prediction: ${posts[0].Prediction}</li>
                      <li>Percentage: ${posts[0].Percentage}</li>
                    </ul>
                </ul>
                `
              };
          
              transporter.sendMail(mailOptions, function (err, info) {
                if(err){
                  console.log("Message: Something Went Wrong")
                }else{
                  console.log("Test Successful")
                }
              })
            }catch {
              console.log("Something went wrong while catching")
            }

        })
})

job5.start()



///////////////////////////////////////// Job to Send Diabetes ML report ends //////////////////////////////////////
















////////////////////////////////////// Starting Server /////////////////////////////////////////////


server.listen(port, () => console.log(`Listening on port ${port}`));


////////////////////////////////////// Stopping Server //////////////////////////////////////////