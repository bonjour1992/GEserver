import express from "express";
import * as partie from "./partie.js";

/*
 * Routes de l'engine de jeu, montées sur /partie (après l'authentification).
 * Voir client/src/Game/Ti5/doc/structure.md.
 */

export async function init(DB) {
    partie.db.partie = DB.collection("partie");
    partie.db.coup = DB.collection("partieCoup");
    partie.db.ids = DB.collection("ids");
    partie.db.chat = DB.collection("partieChat");

    await partie.init();
}

export const router = express.Router();

// L'identifiant d'une partie n'est fait que de chiffres ("12abc" ou "012"
// ne désignent pas la partie 12)
router.param("id", (req, res, next, id) => {

    if (!/^[1-9]\d{0,8}$/.test(id)) {
        return res.status(404).json({ error: "Partie introuvable" });
    }

    next();
});

// Liste des parties d'un jeu
router.get("/", async (req, res) => {
    res.json(await partie.lister(String(req.query.jeu || "")));
});

// Création
router.post("/", async (req, res) => {
    res.json(await partie.creer(req.body || {}, req.user));
});

// La partie et son état, filtrés pour le demandeur
router.get("/:id", async (req, res) => {
    res.json(await partie.getVue(req.params.id, req.user));
});

// Interrogation périodique : { rev } seul si rien n'a changé
router.get("/:id/suite", async (req, res) => {
    res.json(await partie.getSuite(
        req.params.id,
        req.user,
        parseInt(req.query.rev, 10),
        req.query.chat === undefined ? undefined : parseInt(req.query.chat, 10)
    ));
});

// Chat : écrire un message (a : destinataire d'un message privé)
router.post("/:id/chat", async (req, res) => {
    res.json(await partie.ecrire(req.params.id, req.user, req.body || {}));
});

// Historique : coups plus anciens que ?avant=<n>
router.get("/:id/coups", async (req, res) => {
    res.json(await partie.getCoups(req.params.id, req.user, req.query.avant));
});

// Prendre ou changer son siège (en préparation)
router.post("/:id/siege", async (req, res) => {
    res.json(await partie.prendreSiege(req.params.id, req.user, req.body || {}));
});

router.delete("/:id/siege", async (req, res) => {
    res.json(await partie.quitterSiege(req.params.id, req.user));
});

// Mise en place (créateur)
router.post("/:id/lancer", async (req, res) => {
    res.json(await partie.lancer(req.params.id, req.user));
});

// Envoyer un coup
router.post("/:id/coups", async (req, res) => {
    res.json(await partie.jouer(req.params.id, req.user, req.body || {}));
});

// Supprimer la partie (créateur)
router.delete("/:id", async (req, res) => {
    res.json(await partie.supprimer(req.params.id, req.user));
});

// Erreurs
router.use((err, req, res, next) => {

    if (err instanceof partie.Erreur) {
        return res.status(err.status).json({ error: err.message });
    }

    console.error("Erreur /partie :", err);

    res.status(500).json({ error: "Erreur interne" });
});
