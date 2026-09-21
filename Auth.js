import crypto from "crypto";

export let db = {
  user: null,
  tokenAuth: null,
  tokenInvite: null,
  ids: null
};


export class User {

  constructor() {
    this.id = 0;
    this.name = "";
    this.data = {};
  }
}


/*
 * Durée de validité d'un token :
 * 3 mois
 */
const TOKEN_DURATION = 1000 * 60 * 60 * 24 * 90;


/*
 * Création d'un token d'authentification.
 */
function createToken() {
  return crypto.randomBytes(32).toString("hex");
}


/*
 * Hash d'un mot de passe.
 *
 * On utilise scrypt avec un sel aléatoire.
 *
 * Le résultat stocké en BDD est :
 *
 * salt:hash
 */
export async function hashPassword(password) {

  const salt = crypto.randomBytes(16).toString("hex");

  const hash = await new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      64,
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(derivedKey.toString("hex"));
      }
    );
  });

  return salt + ":" + hash;
}


/*
 * Vérifie un mot de passe par rapport
 * au hash stocké en BDD.
 */
async function checkPassword(password, storedHash) {

  if (!storedHash) {
    return false;
  }

  const parts = storedHash.split(":");

  if (parts.length !== 2) {
    return false;
  }

  const salt = parts[0];
  const expectedHash = parts[1];

  const hash = await new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      64,
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(derivedKey.toString("hex"));
      }
    );
  });

  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(expectedHash, "hex")
  );
}


/*
 * Recherche un utilisateur par son login.
 */
async function getUserByLogin(login) {

  return await db.user?.findOne({
    login: login
  });
}


/*
 * Transformation du document MongoDB
 * en objet User utilisé par le reste du backend.
 */
function buildUser(data) {

  const u = new User();

  u.id = data.id;
  u.name = data.login;
  u.data = data.data || {};

  return u;
}


/*
 * Connexion.
 *
 * login + mot de passe en clair arrivent ici.
 *
 * Le mot de passe est comparé avec le hash
 * présent dans MongoDB.
 */
export async function login(login, password) {

  const data = await getUserByLogin(login);

  if (!data) {
    return null;
  }

  const valid = await checkPassword(
    password,
    data.hashPassword
  );

  if (!valid) {
    return null;
  }

  const token = createToken();

  const expire = Date.now() + TOKEN_DURATION;

  await db.tokenAuth.insertOne({
    token,
    userId: data.id,
    expire
  });

  return {
    token,
    user: buildUser(data)
  };
}
/*

Création d'un utilisateur avec invitation.

L'inscription nécessite une invitation

valide présente dans MongoDB.

Une invitation est supprimée après

utilisation réussie.
*/
export async function createUser(
  login,
  password,
  invitationCode
) {

  /*
  
  Recherche de l'invitation.
  */
  const invite = await db.tokenInvite?.findOne({
    code: invitationCode
  });

  /*
  
  Invitation inexistante ou expirée.
  */
  if (
    !invite ||
    (invite.expire && invite.expire <= Date.now())
  ) {
    return null;
  }

  /*
  
  Vérification que le login n'existe pas déjà.
  */
  const existing = await getUserByLogin(login);

  if (existing) {
    return null;
  }

  /*
  
  Création de l'id utilisateur.
  */
  const id = await nextId("user");

  /*
  
  Hash du mot de passe.
  */
  const hash = await hashPassword(password);

  /*
  
  Document MongoDB.
  */
  const data = {
    id,
    login,
    hashPassword: hash,
    data: {}
  };

  await db.user.insertOne(data);

  /*
  
  L'invitation est à usage unique.
  
  On la supprime uniquement après
  
  la création réussie de l'utilisateur.
  */
  await db.tokenInvite.deleteOne({
    _id: invite._id
  });

  /*
  
  Connexion immédiate.
  */
  const token = createToken();

  const expire = Date.now() + TOKEN_DURATION;

  await db.tokenAuth.insertOne({
    token,
    userId: id,
    expire
  });

  return {
    token,
    user: buildUser(data)
  };
}


/*
 * Vérifie un token d'authentification.
 *
 * Retourne l'id utilisateur.
 */
export async function checkLogin(token) {

  if (!token) {
    return null;
  }

  const auth = await db.tokenAuth?.findOne({
    token
  });

  if (!auth) {
    return null;
  }

  /*
   * Token expiré.
   */
  if (auth.expire <= Date.now()) {

    await db.tokenAuth.deleteOne({
      _id: auth._id
    });

    return null;
  }

  /*
   * Vérification que l'utilisateur existe toujours.
   */
  const user = await db.user?.findOne({
    id: auth.userId
  });

  if (!user) {
    return null;
  }

  return user.id;
}


/*
 * Récupère un User à partir de son id.
 */
export async function getUser(id) {

  const data = await db.user?.findOne({
    id
  });

  if (!data) {
    return null;
  }

  return buildUser(data);
}


/*
 * Gestion des droits.
 */
export function checkGrant(u, level) {
  return true;
}


/*
 * Génération d'un nouvel id.
 */
async function nextId(id) {

  const val = await db.ids?.findOne({
    id
  });

  if (!val) {

    await db.ids?.insertOne({
      id,
      val: 1
    });

    return 1;

  } else {

    await db.ids?.updateOne(
      { id },
      {
        "$inc": {
          val: 1
        }
      }
    );

    return val.val + 1;
  }
}


/*
 * Déconnexion.
 *
 * Supprime le token d'authentification.
 */
export async function logout(token) {

  if (!token) {
    return;
  }

  await db.tokenAuth?.deleteOne({
    token
  });
}
export async function middleware(req, res, next) {

  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Authentification requise"
    });
  }

  const token = header.substring(7);

  const userId = await checkLogin(token);

  if (!userId) {
    return res.status(401).json({
      error: "Token invalide ou expiré"
    });
  }

  const user = await getUser(userId);

  if (!user) {
    return res.status(401).json({
      error: "Utilisateur introuvable"
    });
  }

  req.user = user;
  req.userId = user.id;
  req.token = token;

  next();
}


/*
 * Retourne la liste des utilisateurs.
 *
 * Attention :
 * on ne renvoie jamais le mot de passe.
 */
export async function getUsers() {

  const users = await db.user?.find(
    {},
    {
      projection: {
        _id: 0,
        id: 1,
        login: 1,
        data: 1
      }
    }
  ).toArray();

  return users || [];
}



/*

Création d'un code d'invitation.

Les invitations sont valables 15 jours

et sont à usage unique.
*/
export async function createInvite() {

  const code = createToken().substring(0, 12);

  const expire =
    Date.now() +
    1000 * 60 * 60 * 24 * 15;

  await db.tokenInvite.insertOne({
    code,
    expire
  });

  return {
    code,
    expire
  };
}