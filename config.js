const nodemailer = require("nodemailer")
const dotenv = require('dotenv')
dotenv.config()

// Code to send mail
var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth : {
      user : process.env.email,
      pass : process.env.password
    }
})

module.exports = transporter;