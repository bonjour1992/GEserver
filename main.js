import express from 'express'
import * as element from "./element.js"
import * as remp from "./remp.js"
import * as auth from "./Auth.js"
import * as tag from "./tag.js"
import { getImage, saveImage } from './image.js';


import { DB, DBInit } from './db.js';
import { config } from 'dotenv';
import cors from 'cors'
import { csstoarray } from './temp/script.js';



//load .env
config()

//connect to DB
DBInit()
element.db.elements = (await DB).collection("element")
element.db.ids = (await DB).collection("ids")
remp.db.remplacement = (await DB).collection("remplacement")
auth.db.user = (await DB).collection("GEuser")
tag.db.tag = (await DB).collection("tag")
//scripting


//API

const app = express()
app.use(cors());
app.use('/public', express.static('public'))
app.use(express.json())


//create new element return ID
app.post('/element/new', async (req, res) => {
  let data = await req.body;
  let id = await element.save(await element.buildElement(data.content, data.meta.jeu, data.meta.type, 0, 0, "CREATED"))
  res.json({ message: "Element created with id:" + id, id: id, action: "CREATE" });

})

// get  last version of element ID 
app.get('/element/:id', async (req, res) => {
  let carte = await element.getElement(req.params.id)
  if (carte) res.json(carte)
  else res.status(404).json(null)
})


// update element ID
app.post('/element/:id', async (req, res) => {
  let data = await req.body;
  element.save(await element.buildElement(data.content, data.meta.jeu, data.meta.type, parseInt(req.params.id), 0, "UPDATED"))
  res.json({ message: "Element updated with id:" + req.params.id, id: req.params.id, action: "UPDATE" });
})


// delete element ID
app.delete('/element/:id', async (req, res) => {
  let data = await element.getElement(req.params.id)
  element.save(await element.buildElement({ name: data.content.name }, data.meta.jeu, data.meta.type, parseInt(req.params.id), 0, "DELETED"))
  res.json({ message: "Element id:" + req.params.id + "deleted", id: req.params.id, action: "DELETE" });
})



// get search hearder for all element
app.get('/element/search/:jeu', async (req, res) => {
  res.json(await element.getSearch(req.params.jeu))
})

//TODO:delete element ID
app.delete('/element/:id', (req, res) => {

  res.send('Hello World')
})

// get nombre d'element par TYPE
app.get('/element/:jeu/stat', async (req, res) => {
  res.json(await element.getStat(req.params.jeu))
})

// get all element TYPE
app.get('/element/:jeu/:type', async (req, res) => {
  res.json(await element.getListElement(req.params.jeu, req.params.type))
})



//get all remplacement
app.get('/remp/:jeu', async (req, res) => {

  res.json(await remp.getAll(req.params.jeu))

})


//update table of element
app.post('/remp/update/:jeu', async (req, res) => {
  let data = await req.body;
  await remp.update(data, req.params.jeu)
  res.json(await remp.getAll(req.params.jeu))

})

// get all available image
app.get('/image', async (req, res) => {
  let imgs = await getImage()
  res.json(imgs)
})
//upload image
app.post(
  "/upload-image",
  express.raw({ type: "image/*", limit: "10mb" }),
  async (req, res) => {
    await saveImage(req)

    res.json({
      success: true,
    });
  })

app.get('/tag/all', async (req, res) => {
  let tags = await tag.get(req.params.type)
  res.json(tags)
})

app.post('/tag/:type/new', async (req, res) => {
  let data = await req.body;
  await tag.add(req.params.type,data)
  res.json(await remp.getAll(req.params.jeu))

})

app.listen(process.env.PORT, () => {
  console.log('Server is running on port:'+process.env.PORT)
})

