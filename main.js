import express from 'express'
import * as element from "./element.js"
import * as remp from "./remp.js"
import * as auth from "./Auth.js"
import * as tag from "./tag.js"
import { getImage, saveImage } from './image.js';
import * as partie from './partieRoutes.js';


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
auth.db.tokenAuth = (await DB).collection("GEtokenAuth")
auth.db.tokenInvite = (await DB).collection("GEtokenInvite")
auth.db.ids = (await DB).collection("ids")
await partie.init(await DB)

//scripting


const app = express()

app.use(cors());
app.use('/public', express.static('public'))
app.use(express.json())


/*
 * =========================
 * AUTHENTIFICATION PUBLIQUE
 * =========================
 */

app.post('/auth/invite/use/:code', async (req, res) => {
  const { login, password } = req.body;

  if (!login || !password) {
    return res.status(400).json({
      error: "Login et mot de passe obligatoires"
    });
  }

  const result = await auth.createUser(
    login.trim(),
    password,
    req.params.code
  );

  if (!result) {
    return res.status(400).json({
      error: "Invitation invalide ou login déjà utilisé"
    });
  }

  res.json(result);
});


app.post('/auth/login', async (req, res) => {

  const { login, password } = req.body;

  if (!login || !password) {
    return res.status(400).json({
      error: "Login et mot de passe obligatoires"
    });
  }

  const result = await auth.login(
    login.trim(),
    password
  );

  if (!result) {
    return res.status(401).json({
      error: "Login ou mot de passe incorrect"
    });
  }

  res.json(result);
});


/*
 * =========================
 * AUTHENTIFICATION OBLIGATOIRE
 * =========================
 */

app.use(auth.middleware);


/*
 * =========================
 * API DE L'APPLICATION
 * =========================
 */

/*
 * Utilisateur connecté (permet au client de savoir s'il est admin).
 */
app.get('/auth/me', async (req, res) => {
  res.json(req.user);
});


/*
 * Liste des utilisateurs : réservée aux admins.
 */
app.get('/auth/users', auth.requireAdmin, async (req, res) => {

  const users = await auth.getUsers();

  res.json(users);
});


/*
 * Création d'un code d'invitation : réservée aux admins.
 */
app.post('/auth/invite/new', auth.requireAdmin, async (req, res) => {

  const invite = await auth.createInvite();

  res.json(invite);
});


/*
 * Déconnexion.
 *
 * Cette route nécessite une authentification.
 */
app.post('/auth/logout', async (req, res) => {

  await auth.logout(req.token);

  res.json({
    success: true
  });
});


// Engine de jeu (parties)
app.use('/partie', partie.router)


//
// =========================
// ELEMENTS
// =========================
//

// Liste/recherche
app.get('/elements/search/:jeu', async (req, res) => {
  res.json(await element.getSearch(req.params.jeu));
});


// Statistiques d'un jeu
app.get('/elements/:jeu/stats', async (req, res) => {
  res.json(await element.getStat(req.params.jeu));
});


// Éléments supprimés d'un jeu
app.get('/elements/:jeu/deleted', async (req, res) => {

  const deleted = await element.getDeletedElements(
    req.params.jeu
  );

  res.json(deleted);
});

// Restaurer un élément supprimé
app.post('/elements/:elementId/restore', async (req, res) => {

  const restored = await element.restoreDeletedElement(
    req.params.elementId,
    req.user
  );

  if (!restored) {
    return res.status(404).json({
      error: "Element supprimé introuvable ou impossible à restaurer"
    });
  }

  res.json({
    message: "Element restauré",
    id: parseInt(req.params.elementId, 10),
    version: restored.insertedId,
    action: "RESTORE"
  });
});


// Liste des éléments d'un jeu et d'un type
app.get('/elements/:jeu/type/:type', async (req, res) => {
  res.json(
    await element.getListElement(
      req.params.jeu,
      req.params.type
    )
  );
});


// Création
app.post('/elements', async (req, res) => {

  const data = req.body;

  const elementData = await element.buildElement(
    data.content,
    data.meta.jeu,
    data.meta.type,
    0,
    req.user,
    "CREATED"
  );

  const id = await element.save(elementData);

  res.json({
    message: "Element created with id:" + id,
    id,
    action: "CREATE"
  });
});


// Dernière version d'un élément
app.get('/elements/:elementId', async (req, res) => {

  const carte = await element.getElement(
    req.params.elementId
  );

  if (carte) {
    res.json(carte);
  } else {
    res.status(404).json(null);
  }
});


// Mise à jour
app.post('/elements/:elementId', async (req, res) => {

  const data = req.body;
  const id = parseInt(req.params.elementId, 10);

  const elementData = await element.buildElement(
    data.content,
    data.meta.jeu,
    data.meta.type,
    id,
    req.user,
    "UPDATED"
  );

  await element.save(elementData);

  res.json({
    message: "Element updated with id:" + id,
    id,
    action: "UPDATE"
  });
});


// Suppression
app.delete('/elements/:elementId', async (req, res) => {

  const id = parseInt(req.params.elementId, 10);
  const data = await element.getElement(id);

  if (!data) {
    return res.status(404).json({
      error: "Element introuvable"
    });
  }

  const elementData = await element.buildElement(
    { name: data.content.name },
    data.meta.jeu,
    data.meta.type,
    id,
    req.user,
    "DELETED"
  );

  await element.save(elementData);

  res.json({
    message: "Element id:" + id + " deleted",
    id,
    action: "DELETE"
  });
});


// Versions d'un élément
app.get('/elements/:elementId/versions', async (req, res) => {

  const versions = await element.getElementVersions(
    req.params.elementId
  );

  res.json(versions);
});


// Version précise
app.get('/elements/:elementId/versions/:versionId', async (req, res) => {

  const elementVersion = await element.getElementVersion(
    req.params.elementId,
    req.params.versionId
  );

  if (!elementVersion) {
    return res.status(404).json({
      error: "Version introuvable"
    });
  }

  res.json(elementVersion);
});


// Restaurer une version
app.post('/elements/:elementId/versions/:versionId/restore', async (req, res) => {

  const restored = await element.restoreElement(
    req.params.elementId,
    req.params.versionId,
    req.user
  );

  if (!restored) {
    return res.status(404).json({
      error: "Version introuvable"
    });
  }

  res.json({
    message: "Version restaurée",
    id: parseInt(req.params.elementId, 10),
    version: restored.insertedId,
    action: "RESTORE"
  });
});



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
    const saved = await saveImage(req)

    if (!saved) {
      return res.status(400).json({
        success: false,
        error: "Chemin ou fichier image invalide"
      });
    }

    res.json({
      success: true,
    });
  })

app.get('/tag/all', async (req, res) => {
  let tags = await tag.get(req.params.type)
  res.json(tags)
})

app.post('/tag/:type/new', async (req, res) => {
  let data = await req.body.val;
  await tag.add(req.params.type, data)
  res.json(await tag.get())

})




app.listen(process.env.PORT, () => {
  console.log('Server is running on port:' + process.env.PORT)
})

