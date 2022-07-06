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

app.set('views', './views')
app.set('view engine', 'pug');

const pool = require('mysql2').createPool({
    connectionLimit: 5,
    host: process.env.DB_HOST,
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

const rechnungGleich = (r1, r2) => {
    return r1.betrag === r2.betrag && r1.posten === r2.posten && r1.leiter === r2.leiter && r1.kasse === r2.kasse 
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
    const zeilen = []
    images.forEach( image=>{
        const matches = image.name.toLowerCase().split(".")[0].match(regex)
        if(!matches)
        {
            zeilen.push({klasse: "error",text: `Format Fehler bei ${image.name}`})
            processed++
            if(processed==images.length)
            {
                res.render('bildRechnung',{zeilen: zeilen})
                return
            }
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
                zeilen.push({klasse: "error",text: `SQL Fehler bei ${image.name}`})
            }
            else
            {
                zeilen.push({klasse: "",text: image.name})
            }
            processed++
            if(processed==images.length)
            {
                res.render('bildRechnung',{zeilen: zeilen})
                return
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
    var processed = 0
    const werte = {}
    leiter.forEach((leiter,index,array) => {
        pool.query({
            sql: "SELECT SUM(betrag) AS summe FROM rechnungen WHERE leiter = ? AND NOT bezahlt",
            values: [leiter]
        },(err,sqlResponse,fields)=>{
            if(err)
            {
                console.error(err)
                res.sendStatus(500)
                return
            }
            else
            {  
                const total = sqlResponse[0].summe ? sqlResponse[0].summe : 0
                werte[leiter] = formatToEuro(total)
            }
            processed++
            if(processed === array.length)
            {
                res.render("auszahlung",{werte: werte})
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
    const kassenSelector = !req.params.kasse ? "kasse = 'Lagerkosten' OR kasse = 'Transportkosten'" : admin ? "1=1" : "kasse = 'Leiterkasse'"
    const print = req.query.print !== undefined
    req.query.print
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
            var total = 0
            const kassen = {
                "Leiterkasse": [],
                "Lagerkosten": [],
                "Transportkosten": []
            }
            var kosten = {
                "Leiterkasse": 0,
                "Lagerkosten": 0,
                "Transportkosten": 0
            }
            sqlResponse.forEach(rechnung => {
                total += rechnung.betrag
                kosten[rechnung.kasse] += rechnung.betrag
                rechnung.betrag = formatToEuro(rechnung.betrag)
                kassen[rechnung.kasse].forEach(r2 => {
                    if(rechnungGleich(rechnung,r2))
                    {
                        rechnung.doppelt = true
                    }
                })
                kassen[rechnung.kasse].push(rechnung)            
            })
            kosten["Leiterkasse"] = formatToEuro(kosten["Leiterkasse"])
            kosten["Lagerkosten"] = formatToEuro(kosten["Lagerkosten"])
            kosten["Transportkosten"] = formatToEuro(kosten["Transportkosten"])
           res.render('bericht',{year: new Date().getFullYear(), kassen: kassen, kosten: kosten, print: print, summe: formatToEuro(total), admin: admin})
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
            var i
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