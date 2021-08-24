"use strict";
require('dotenv').config()

const express = require('express')
const app = module.exports = express()
app.set("x-powered-by",false)
const basicAuth = require('express-basic-auth')

const users = {}
users[process.env.WEB_USER] = process.env.WEB_PW

app.use(basicAuth({
    users: users,
    challenge: true
}))

app.use(express.static('public'))

app.use(express.urlencoded({ extended: true }))

app.use(require('express-fileupload')())

const pool = require('mysql').createPool({
    connectionLimit: 5,
    socketPath: process.env.DB_SOCK_PATH,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_DATABASE
  })

const formatToEuro = (cents) => {
    const padded = cents.toString().padStart(4,"0")
    return padded.slice(0,-2) + "," + padded.slice(-2)
}

const formatToCents = (euro) => {
    return euro * 100
}

var leiter

const leiterAbrufen = () => {
    pool.query(
        "SELECT SUBSTRING(COLUMN_TYPE,5) AS leiter FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='tas' AND TABLE_NAME='rechnungen' AND COLUMN_NAME='leiter';",
        (err,sqlResponse,fields)=>{
            if(err)
            {
                console.error(err)
            }
            else if(sqlResponse[0])
            {
                leiter = sqlResponse[0].leiter.slice(1,-1).split(",").map(name => name.slice(1,-1))
            }
            else
            {
                leiter = []
            }
    })
}

leiterAbrufen()

/*
app.get('/rechnung',(req,res)=>{
    pool.query({
        sql: "SELECT posten,betrag,leiter,kasse FROM rechnungen;"
    },(err,sqlResponse,fields)=>{
        if(err)
        {
            console.error(err)
            res.sendStatus(500)
        }
        else
        {
            res.status(200)
            sqlResponse.forEach(rechnung => {
                res.write( `${rechnung.posten} ${rechnung.betrag} ${rechnung.leiter} ${rechnung.kasse}\n` )
            })
            res.end()
        }
    })
})
*/

app.post('/rechnung',(req,res)=>{
    pool.query({
        sql: "INSERT INTO rechnungen (posten,betrag,leiter,kasse,bezahlt,bild) VALUES (?,?,?,?,?,BINARY(?));",
        values: [
            req.body.posten,
            formatToCents(req.body.betrag),
            req.body.leiter,
            req.body.kasse,
            req.body.bezahlt === "on",
            req.files ? req.files.bild.data : null
        ]
    },(err,sqlResponse,fields)=>{
        if(err)
        {
            console.error(err)
            res.sendStatus(500)
        }
        else
        {
            res.redirect("/rechnung.html")
        }

    })
})

app.post('/bildRechnung',(req,res)=>{
    if(!req.files || !req.files.bild)
    {
        res.sendStatus(400)
        return
    }
    res.write("<html><head><meta charset='UTF-8'><style>p{background-color:lightgreen;} .error{color:black;background-color:red;}</style></head><body><a href='/'><h1>TAS - Bild Rechnung</h1></a><a href='/bildRechnung.html'>Neue Bildrechnung</a>")
    var leiterRegEx = "("
    leiter.forEach((name,index,array)=>{
        leiterRegEx+=name.toLowerCase()
        if(index+1<array.length)
            leiterRegEx+="|"
    })
    leiterRegEx += ")"
    const regex = "(?<leiter>"+leiterRegEx+")-(?<posten>[a-z]+)-(?<kasse>(le[a-z]*|la[a-z]*|t[a-z]*))-(?<euro>\\d+)_(?<cents>\\d{2})(?<bezahlt>(-b){1}[a-z]*)?"
    const images = Array.isArray(req.files.bild) ? req.files.bild : [req.files.bild]
    var processed = 0
    images.forEach( image=>{
        const matches = image.name.toLowerCase().split(".")[0].match(regex)
        if(!matches)
        {
            res.write(`<p class="error">Format Fehler bei ${image.name}</p>\n`)
            processed++
            if(processed==images.length)
            {
                res.write("</body></html>")
                res.end()
            }
            return
        }
        const betrag = parseInt(matches.groups.euro)*100 + parseInt(matches.groups.cents)
        var kasse = "Lagerkosten"
        if(matches.groups.kasse[0] == 't')
            kasse = "Transportkosten"
        else if(matches.groups.kasse.slice(0,2) == "le")
            kasse = "Leiterkasse"
        pool.query({
            sql: "INSERT INTO rechnungen (posten,betrag,leiter,kasse,bezahlt,bild) VALUES (?,?,?,?,?,BINARY(?));",
            values: [
                matches.groups.posten[0].toUpperCase()+matches.groups.posten.slice(1),
                betrag,
                matches.groups.leiter,
                kasse,
                matches.groups.bezahlt ? true : false,
                image.data
            ]
        },(err,sqlResponse,fields)=>{
            if(err)
            {
                res.write(`<p class="error">SQL Fehler bei ${image.name}</p>\n`)
            }
            else
            {
                res.write(`<p>${image.name}</p>\n`)
            }
            processed++
            if(processed==images.length)
            {
                res.write("</body></html>")
                res.end()
            }
        })
    })

})

app.get('/bild/:id',(req,res)=>{
    pool.query({
        sql: "SELECT bild FROM rechnungen WHERE id = ?;",
        values: [
            req.params.id
        ]
    },(err,sqlResponse,fields)=>{
        if(err)
        {
            console.error(err)
            res.sendStatus(404)
        }
        else
        {
            res.status(200).send(sqlResponse[0].bild)
        }
    })
})

app.get('/auszahlung',(req,res)=>{
    res.write("<html><head><meta charset='UTF-8'><style></style></head><body><a href='/'><h1>TAS - Auszahlung</h1></a>")
    var processed = 0
    leiter.forEach((leiter,index,array) => {
        pool.query({
            sql: "SELECT SUM(betrag) AS summe FROM rechnungen WHERE leiter = ? AND NOT bezahlt",
            values: [leiter]
        },(err,sqlResponse,fields)=>{
            if(err)
            {
                console.error(err)
                res.write("ERROR!")
                res.end()
                return
            }
            else
            {  
                const total = sqlResponse[0].summe ? sqlResponse[0].summe : 0
                res.write(`<p><span>${leiter} ${formatToEuro(total)}€ </span><button onclick="confirm('${leiter} ${formatToEuro(total)}€ bezahlen?')?window.location.href='/bezahlen/${leiter}':null">Bezahlen</button></p>`)
            }
            processed++
            if(processed === array.length)
            {
                res.write("</body></html>")
                res.end()
            }
        })
    })
})

app.get('/bezahlen/:name',(req,res)=>{
    pool.query({
        sql: "UPDATE rechnungen SET bezahlt = TRUE WHERE leiter = ?;",
        values: [
            req.params.name
        ]
    },(err,sqlResponse,fields)=>{
        if(err)
        {
            console.error(err)
            res.sendStatus(500)
        }
        else
        {
            res.redirect('/auszahlung')
        }
    })
})

app.get('/entfernen/:id',(req,res)=>{
    pool.query({
        sql: "DELETE FROM rechnungen WHERE id = ?;",
        values: [
            req.params.id
        ]
    },(err,sqlResponse,fields)=>{
        if(err)
        {
            console.error(err)
            res.sendStatus(500)
        }
        else
        {
            res.redirect('/bericht/admin')
        }
    })
})

app.get('/bericht/:kasse?',(req,res)=>{
    const admin = req.params.kasse == "admin"
    const kassenSelector = !req.params.kasse ? "kasse = 'Lagerkosten' OR kasse = 'Transportkosten'" : admin ? "1=1" : "kasse = 'leiterkasse'"
    pool.query({
        sql: `SELECT id,posten,betrag,kasse,bezahlt,leiter FROM rechnungen WHERE ${ kassenSelector } ORDER BY kasse,id;`
    },(err,sqlResponse,fields)=>{
        if(err)
        {
            console.error(err)
            res.sendStatus(500)
        }
        else
        {
            res.status(200)
            const year = new Date().getFullYear()
            res.write("<html><head><meta charset='UTF-8'><style>th,td {border-bottom: 1px solid black;} img{max-width:500px;max-height:500px;}</style></head><body><h1>Südtirol Abrechnung "+year+"</h1><div id='main'>")
            var kasse = null
            var total = 0
            sqlResponse.forEach(rechnung => {
                if(kasse != rechnung.kasse)
                {
                    kasse = rechnung.kasse
                    if(kasse)
                        res.write("</table>")
                    res.write(`<h2>${kasse}</h2>`)
                    res.write("<table><tr><th>Betrag</th><th>Posten</th><th>Rechung</th></tr>")
                }
                res.write( `<tr><td>${formatToEuro(rechnung.betrag)}€</td><td>${rechnung.posten}</td><td><img src="/bild/${rechnung.id}" onerror="this.parentElement.innerHTML='- unbelegt -'"></td>${admin?`<td><span>${rechnung.leiter} ${rechnung.bezahlt ? "bezahlt":""}</span> <button onclick="confirm('Rechnung ${rechnung.posten} löschen?')?window.location.href='/entfernen/${rechnung.id}':null">Löschen</buttton></td>`:""}</tr>\n` )
                total += rechnung.betrag
            })
            res.write("</table>")
            res.write(`<h3>Summe: ${formatToEuro(total)} €</h3>`)
            res.write("</body></html>")
            res.end()
        }
    })
})

app.get("/leiter",(req,res)=>{
    leiter.forEach(l=>res.write(l+","))
    res.end()
})

app.post('/setup',(req,res)=>{
    if(!req.body.leiter || req.body.leiter.length == 0)
    {
        res.sendStatus(400)
        return
    }
    else
    {
        req.body.leiter = req.body.leiter.split("\n").map(leiter=>leiter.trim())
    }
    pool.query("DROP TABLE IF EXISTS rechnungen;",(err,sqlResponse,fields)=>{
        if(err)
        {
            console.error(err)
            res.sendStatus(500)
        }
        else
        {
            var leiterString = ""
            for(i = 0; i < req.body.leiter.length; i++)
            {
                leiterString += "?"
                if(i+1 < req.body.leiter.length)
                    leiterString += ","
            }
            pool.query({
                sql: "CREATE TABLE rechnungen ( id INT PRIMARY KEY AUTO_INCREMENT, posten VARCHAR(30) NOT NULL, betrag INT NOT NULL, leiter ENUM("+leiterString+") NOT NULL, kasse ENUM('Leiterkasse','Lagerkosten','Transportkosten') NOT NULL, bezahlt BOOLEAN NOT NULL, bild MEDIUMBLOB );",
                values: req.body.leiter
            },(err,sqlResponse,fields)=>{
                if(err)
                {
                    console.error(err)
                    res.sendStatus(500)
                }
                else
                {
                    leiterAbrufen()
                    res.redirect('/')
                }
            })
        }
    })
})

app.listen(process.env.PORT, () => {
    console.log(`TAS started on port ${process.env.PORT}`)
  })