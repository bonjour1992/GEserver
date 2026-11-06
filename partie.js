import crypto from "crypto";
import { getElement, getListElement } from "./element.js";

// Logique partagée avec le client : état, actions, visibilité.
import * as regles from "../client/src/Game/Ti5/engine/etat.js";
import { miseEnPlace as miseEnPlaceTi5 } from "../client/src/Game/Ti5/engine/miseEnPlace.js";

/*
 * ============================================================
 * PARTIES (engine de jeu)
 * ============================================================
 *
 * Voir client/src/Game/Ti5/doc/structure.md.
 *
 * Le serveur applique lui-même les coups : il est le seul à
 * connaître l'état complet, et n'envoie à chaque joueur que ce
 * qu'il a le droit de voir.
 */

export let db = { partie: null, coup: null, ids: null, chat: null };

export class Erreur extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

// Mise en place selon le jeu
const MISE_EN_PLACE = { ti5: miseEnPlaceTi5 };

const NOMBRE_COUPS_ENVOYES = 40;
const MAX_ACTIONS = 300;

const alea = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

export async function init() {
    await db.partie.createIndex({ id: 1 }, { unique: true });
    await db.coup.createIndex({ partie: 1, n: 1 }, { unique: true });
    await db.chat.createIndex({ partie: 1, n: 1 }, { unique: true });
}

/*
 * File d'attente par partie : les modifications d'une même
 * partie sont traitées une par une, dans leur ordre d'arrivée.
 */
const files = new Map();

// Identifiant de partie : un entier (les routes n'acceptent que des chiffres)
function numero(id) {
    const n = typeof id === "number" ? id : (/^\d{1,9}$/.test(String(id)) ? Number(id) : NaN);

    if (!Number.isInteger(n)) {
        throw new Erreur("Partie introuvable", 404);
    }

    return n;
}

function enFile(id, tache) {

    // La clé est le numéro : "12" et "012" désignent la même file
    const cle = numero(id);

    const resultat = (files.get(cle) || Promise.resolve()).then(tache);
    const suite = resultat.catch(() => { });

    files.set(cle, suite);

    // File vide : l'entrée est retirée
    suite.then(() => {
        if (files.get(cle) === suite) {
            files.delete(cle);
        }
    });

    return resultat;
}

async function nextId(id) {
    const val = await db.ids.findOneAndUpdate(
        { id },
        { $inc: { val: 1 } },
        { upsert: true, returnDocument: "after" }
    );

    return val.val;
}

async function charger(id) {
    const p = await db.partie.findOne({ id: numero(id) });

    if (!p) {
        throw new Erreur("Partie introuvable", 404);
    }

    return p;
}

async function enregistrer(p) {
    p.rev++;

    await db.partie.updateOne(
        { id: p.id },
        {
            $set: {
                statut: p.statut,
                joueurs: p.joueurs,
                etat: p.etat,
                version: p.version,
                rev: p.rev,
            }
        }
    );
}

const estJoueur = (p, userId) => p.joueurs.some(j => j.userId === userId);

function resume(p) {
    return {
        id: p.id,
        jeu: p.jeu,
        nom: p.nom,
        statut: p.statut,
        createur: p.createur,
        plateau: p.plateau,
        joueurs: p.joueurs,
        version: p.version,
        cree: p.cree,
        // Où en est la partie (liste des parties)
        tour: p.etat?.tour ?? null,
        phase: p.etat?.phase ?? "",
    };
}

/*
 * ============================================================
 * COUPS
 * ============================================================
 */

const CHAMPS_ACTION = [
    "type", "c", "vers", "sur", "de", "zone", "n", "faces", "id", "delta",
    "valeur", "face", "marque", "tour", "phase", "joueurActif", "anneaux", "jeton", "annuler",
];

// Un champ d'action n'entre au journal que s'il est simple : nombre fini,
// booléen ou chaîne courte (les zones et identifiants sont des chaînes)
const CHAMPS_TEXTE = ["type", "c", "vers", "sur", "de", "zone", "id", "face", "marque", "phase", "jeton"];

function champJournal(champ, valeur) {

    if (typeof valeur === "string") {
        return valeur.length <= 120;
    }

    if (CHAMPS_TEXTE.includes(champ)) {
        return false;
    }

    return typeof valeur === "boolean" || valeur === null ||
        (typeof valeur === "number" && Number.isFinite(valeur));
}

const decrire = c => ({
    id: c.id,
    ref: c.ref,
    jeton: c.jeton,
    dos: c.ref?.type || "jeton",
});

/*
 * Applique les actions d'un coup à l'état (modifié sur place).
 *
 * Chaque action appliquée est notée avec `visible` : "tous", ou la
 * liste des joueurs qui voient le composant avant ou après l'action.
 */
export function appliquerCoup(etat, actions, auteur, joueurs) {

    // joueurs : identifiants des joueurs de la partie (action « encaisser »)
    const ctx = { auteur, alea, joueurs };
    const journal = [];
    const refus = [];

    // Identifiants provisoires des composants créés côté client (idLocal)
    // et leur vrai identifiant, pour les actions suivantes du coup
    // (sans prototype : "constructor" ou "__proto__" n'y sont pas des clés)
    const alias = Object.create(null);

    const aliasDe = id => (typeof id === "string" ? alias[id] : undefined);

    for (let action of actions) {

        if (action && (aliasDe(action.c) || aliasDe(action.sur))) {
            action = {
                ...action,
                c: aliasDe(action.c) || action.c,
                sur: aliasDe(action.sur) || action.sur,
            };
        }

        const cible = typeof action?.c === "string" && Object.hasOwn(etat.composants, action.c)
            ? etat.composants[action.c]
            : null;
        const vues = [];

        if (cible) {
            vues.push(regles.quiVoit(cible, etat));
        }

        if (action?.type === "piocher" && typeof action.de === "string") {
            vues.push(regles.joueurDeMain(action.de));
        }

        const de = cible?.zone;

        // Le composant part-il d'une zone dont les autres ne reçoivent rien
        // (plateau de vote caché, zone secrète) ?
        const departInvisible = cible ? regles.zoneInvisible(cible.zone, etat) : null;

        const r = regles.appliquer(etat, action, ctx);

        if (!r.ok) {
            refus.push({ type: action?.type, erreur: r.erreur });
            continue;
        }

        if (action.type === "creer" && /^t\d{1,12}$/.test(String(action.idLocal)) && r.composants.length === 1) {
            alias[action.idLocal] = r.composants[0];
        }

        const composants = r.composants.map(id => etat.composants[id]);

        vues.push(...composants.map(c => regles.quiVoit(c, etat)));

        const entree = {};

        for (const champ of CHAMPS_ACTION) {
            if (action[champ] !== undefined && champJournal(champ, action[champ])) {
                entree[champ] = action[champ];
            }
        }

        if (de !== undefined) {
            entree.de = de;
        }

        // La zone d'arrivée notée est la zone réelle, pas celle annoncée par
        // le client (un composant posé « sur » un autre prend sa zone)
        if (action.type === "deplacer" && composants.length) {
            entree.vers = composants[0].zone;
        }

        if (action.type === "creer" && composants.length) {
            entree.zone = composants[0].zone;
        }

        entree.composants = composants.map(decrire);

        if (r.resultats) {
            entree.resultats = r.resultats;
        }

        entree.visible = !composants.length || vues.includes("tous")
            ? "tous"
            : [...new Set(vues.filter(v => v !== null))];

        // Consultation d'une carte cachée : son contenu n'est montré qu'à l'auteur
        if (action.type === "consulter") {
            entree.visible = [auteur];
        }

        // Choix scellé (faveurs) : seul l'auteur en garde la trace
        if (action.type === "engager") {
            entree.visible = [auteur];
            entree.secret = true;
        }

        // Vers une zone invisible (plateau de vote caché, zone secrète) :
        // l'action n'est montrée qu'à son propriétaire, même si le composant
        // venait d'une zone publique. Depuis une telle zone vers une zone
        // publique : l'action est montrée, mais pas d'où vient le composant.
        const arriveeInvisible = composants
            .map(c => regles.zoneInvisible(c.zone, etat))
            .find(v => v !== null) ?? null;

        if (arriveeInvisible !== null) {
            entree.visible = [arriveeInvisible];
            entree.secret = true;
        } else if (departInvisible !== null) {
            entree.masquerDe = departInvisible;

            // Resté caché à la sortie (vers une main, face cachée) : les
            // autres n'en voient rien non plus
            if (entree.visible !== "tous") {
                entree.secret = true;
            }
        }

        journal.push(entree);
    }

    return { journal, refus };
}

// Version d'un coup pour un joueur donné
export function filtrerCoup(coup, userId) {

    const invisible = zone =>
        regles.joueurDeVote(zone || "") !== null || regles.joueurDeSecret(zone || "") !== null;

    const actions = coup.actions.map(({ visible, masquerDe, secret, ...action }) => {

        if (visible === "tous" || visible.includes(userId)) {

            // Composant sorti d'une zone invisible : seul son joueur sait d'où
            if (masquerDe !== undefined && masquerDe !== userId) {
                const { de, ...reste } = action;
                return reste;
            }

            return action;
        }

        // Plateau de vote caché, zone secrète : rien n'en est montré aux
        // autres, pas même qu'un élément y a été posé ou en a été retiré.
        // (secret : décidé par le serveur à l'application du coup ; le test
        // des zones reste pour les coups enregistrés avant ce champ)
        if (secret || invisible(action.vers) || invisible(action.de) || invisible(action.zone)) {
            return null;
        }

        return {
            type: action.type,
            de: action.de,
            vers: action.vers,
            zone: action.zone,
            composants: action.composants.map(c => ({ dos: c.dos })),
            cache: true,
        };
    }).filter(Boolean);

    return {
        n: coup.n,
        auteur: coup.auteur,
        date: coup.date,
        commentaire: coup.commentaire,
        actions,
    };
}

async function coupsRecents(p, userId, avant) {

    const visibles = [];

    // Un coup dont rien n'est visible pour ce joueur n'est pas listé : on lit
    // par paquets jusqu'à en avoir assez (sinon une série de coups cachés
    // ferait croire que l'historique est fini)
    for (let lot = 0; lot < 10 && visibles.length < NOMBRE_COUPS_ENVOYES; lot++) {

        const filtre = { partie: p.id };

        if (avant) {
            filtre.n = { $lt: avant };
        }

        const coups = await db.coup
            .find(filtre)
            .sort({ n: -1 })
            .limit(NOMBRE_COUPS_ENVOYES)
            .toArray();

        if (!coups.length) {
            break;
        }

        visibles.push(...coups
            .map(c => filtrerCoup(c, userId))
            .filter(c => c.actions.length || c.commentaire || c.auteur === userId));

        avant = coups[coups.length - 1].n;
    }

    return visibles.slice(0, NOMBRE_COUPS_ENVOYES);
}

/*
 * ============================================================
 * VUE D'UNE PARTIE POUR UN UTILISATEUR
 * ============================================================
 */

async function vue(p, userId) {
    return {
        rev: p.rev,
        moi: userId,
        partie: resume(p),
        etat: p.etat ? regles.filtrerEtat(p.etat, userId) : null,
        coups: p.etat ? await coupsRecents(p, userId) : [],
    };
}

export async function getVue(id, user) {
    return vue(await charger(id), user.id);
}

// Interrogation périodique : rien de neuf -> seulement { rev }.
// chat : numéro du dernier message que le client connaît ; les messages
// plus récents qu'il a le droit de lire sont joints à la réponse.
export async function getSuite(id, user, rev, chat) {

    // D'abord la révision seule : l'état complet n'est lu que s'il a changé
    const leger = await db.partie.findOne({ id: numero(id) }, { projection: { _id: 0, id: 1, rev: 1 } });

    if (!leger) {
        throw new Erreur("Partie introuvable", 404);
    }

    const p = leger.rev === rev ? leger : await charger(id);

    const reponse = p.rev === rev ? { rev } : await vue(p, user.id);

    if (Number.isInteger(chat)) {
        const messages = await messagesApres(p, user.id, chat);

        if (messages.length) {
            reponse.chat = messages;
        }
    }

    return reponse;
}

/*
 * ============================================================
 * CHAT
 * ============================================================
 *
 * Un message est global (a : null) ou privé (a : identifiant du
 * destinataire) : un message privé n'est envoyé qu'à son auteur
 * et à son destinataire. Les messages d'une partie sont numérotés
 * (n) ; le client demande ceux qui suivent le dernier qu'il connaît.
 */

const LONGUEUR_MESSAGE = 500;
const NOMBRE_MESSAGES_ENVOYES = 200;

// Numéro du dernier message de chaque partie (évite une requête par
// interrogation quand il n'y a rien de neuf)
const dernierMessage = new Map();

async function numeroDernierMessage(idPartie) {

    if (!dernierMessage.has(idPartie)) {
        const dernier = await db.chat.find({ partie: idPartie }).sort({ n: -1 }).limit(1).next();
        dernierMessage.set(idPartie, dernier?.n || 0);
    }

    return dernierMessage.get(idPartie);
}

const messagePublic = m => ({ n: m.n, auteur: m.auteur, nom: m.nom, a: m.a, texte: m.texte, date: m.date });

async function messagesApres(p, userId, apres) {

    if (await numeroDernierMessage(p.id) <= apres) {
        return [];
    }

    const messages = await db.chat
        .find({
            partie: p.id,
            n: { $gt: apres },
            $or: [{ a: null }, { a: userId }, { auteur: userId }],
        })
        .sort({ n: -1 })
        .limit(NOMBRE_MESSAGES_ENVOYES)
        .toArray();

    return messages.reverse().map(messagePublic);
}

export async function ecrire(id, user, { texte, a }) {

    const p = await charger(id);

    if (!estJoueur(p, user.id)) {
        throw new Erreur("Vous ne jouez pas dans cette partie", 403);
    }

    texte = String(texte ?? "").trim().slice(0, LONGUEUR_MESSAGE);

    if (!texte) {
        throw new Erreur("Message vide");
    }

    const destinataire = a === null || a === undefined ? null : parseInt(a, 10);

    if (destinataire !== null && (destinataire === user.id || !estJoueur(p, destinataire))) {
        throw new Erreur("Destinataire invalide");
    }

    const message = {
        partie: p.id,
        n: await nextId("chat:" + p.id),
        auteur: user.id,
        nom: user.name,
        a: destinataire,
        texte,
        date: Date.now(),
    };

    await db.chat.insertOne(message);
    dernierMessage.set(p.id, Math.max(message.n, dernierMessage.get(p.id) || 0));

    return { message: messagePublic(message) };
}

export async function getCoups(id, user, avant) {
    return coupsRecents(await charger(id), user.id, parseInt(avant, 10) || 0);
}

export async function lister(jeu) {
    const parties = await db.partie
        // De l'état, la liste ne lit que le tour et la phase
        .find({ jeu }, { projection: { _id: 0, "etat.composants": 0, "etat.compteurs": 0, "etat.references": 0 } })
        .sort({ cree: -1 })
        .toArray();

    return parties.map(resume);
}

/*
 * ============================================================
 * PRÉPARATION
 * ============================================================
 */

export async function creer({ jeu, nom, plateau }, user) {

    if (typeof jeu !== "string" || !Object.hasOwn(MISE_EN_PLACE, jeu)) {
        throw new Erreur("Jeu sans engine");
    }

    nom = String(nom || "").trim().slice(0, 80);
    plateau = parseInt(plateau, 10);

    if (!nom) {
        throw new Erreur("Nom obligatoire");
    }

    if (!Number.isInteger(plateau)) {
        throw new Erreur("Plateau obligatoire");
    }

    const p = {
        id: await nextId("partie"),
        jeu,
        nom,
        statut: "preparation",
        createur: user.id,
        plateau,
        joueurs: [],
        version: 0,
        rev: 0,
        cree: Date.now(),
        etat: null,
    };

    await db.partie.insertOne(p);

    return vue(p, user.id);
}

export function prendreSiege(id, user, { faction, couleur }) {
    return enFile(id, async () => {

        const p = await charger(id);

        if (p.statut !== "preparation") {
            throw new Erreur("La partie a déjà commencé");
        }

        faction = parseInt(faction, 10);

        if (!Number.isInteger(faction)) {
            throw new Erreur("Faction obligatoire");
        }

        const siege = {
            userId: user.id,
            nom: user.name,
            faction,
            // (la couleur finit dans un style : un nom ou un code simple)
            couleur: /^[\w#-]{1,20}$/.test(String(couleur || "")) ? String(couleur) : "",
        };

        const index = p.joueurs.findIndex(j => j.userId === user.id);

        if (index === -1) {
            p.joueurs.push(siege);
        } else {
            p.joueurs[index] = siege;
        }

        await enregistrer(p);

        return vue(p, user.id);
    });
}

export function quitterSiege(id, user) {
    return enFile(id, async () => {

        const p = await charger(id);

        if (p.statut !== "preparation") {
            throw new Erreur("La partie a déjà commencé");
        }

        p.joueurs = p.joueurs.filter(j => j.userId !== user.id);

        await enregistrer(p);

        return vue(p, user.id);
    });
}

export function lancer(id, user) {
    return enFile(id, async () => {

        const p = await charger(id);

        if (p.createur !== user.id) {
            throw new Erreur("Seul le créateur peut lancer la partie", 403);
        }

        if (p.statut !== "preparation") {
            throw new Erreur("La partie a déjà commencé");
        }

        if (!p.joueurs.length) {
            throw new Erreur("Aucun joueur");
        }

        p.etat = await MISE_EN_PLACE[p.jeu]({
            partie: p,
            alea,

            charger: async elementId =>
                (await getElement(elementId))?.content ?? null,

            lister: async type =>
                (await getListElement(p.jeu, type))
                    .map(e => ({ id: e.id, content: e.content })),
        });

        p.statut = "en cours";

        await enregistrer(p);

        return vue(p, user.id);
    });
}

export function supprimer(id, user) {
    return enFile(id, async () => {

        const p = await charger(id);

        if (p.createur !== user.id) {
            throw new Erreur("Seul le créateur peut supprimer la partie", 403);
        }

        await db.coup.deleteMany({ partie: p.id });
        await db.chat.deleteMany({ partie: p.id });
        await db.ids.deleteOne({ id: "chat:" + p.id });
        dernierMessage.delete(p.id);
        await db.partie.deleteOne({ id: p.id });

        return { supprime: p.id };
    });
}

/*
 * ============================================================
 * JOUER
 * ============================================================
 */

export function jouer(id, user, { actions, commentaire }) {
    return enFile(id, async () => {

        const p = await charger(id);

        if (p.statut !== "en cours") {
            throw new Erreur("La partie n'est pas en cours");
        }

        if (!estJoueur(p, user.id)) {
            throw new Erreur("Vous ne jouez pas dans cette partie", 403);
        }

        if (!Array.isArray(actions) || !actions.length || actions.length > MAX_ACTIONS) {
            throw new Erreur("Coup invalide");
        }

        // Un coup est tout ou rien : il est essayé sur une copie de l'état,
        // et rien n'est gardé si une seule de ses actions est refusée (un
        // achat ne peut pas être payé sans être livré, ni l'inverse).
        const essai = structuredClone(p.etat);

        const { journal, refus } = appliquerCoup(essai, actions, user.id, p.joueurs.map(j => j.userId));

        if (refus.length) {
            return {
                ...await vue(p, user.id),
                refus,
            };
        }

        p.etat = essai;

        if (journal.length) {

            p.version++;

            // La partie d'abord, le coup ensuite : si l'écriture de la partie
            // échoue, rien n'est noté et la partie reste jouable (l'inverse
            // laissait un coup orphelin qui bloquait tous les suivants).
            await enregistrer(p);

            await db.coup.replaceOne(
                { partie: p.id, n: p.version },
                {
                    partie: p.id,
                    n: p.version,
                    auteur: user.id,
                    date: Date.now(),
                    commentaire: String(commentaire || "").slice(0, 300),
                    actions: journal,
                    refus,
                },
                { upsert: true }
            );
        }

        return {
            ...await vue(p, user.id),
            refus,
        };
    });
}
