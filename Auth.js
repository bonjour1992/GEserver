export let db = { user: null }


export const Access ={
  None : 0,
  Read:1,
  Write:2,
  Total:3,
}

export class User {
  id
  name
  access
  constructor() {
    this.id = 0
    this.name = ""
    this.access = Access.None
  }
}



export async function checkLogin(token){
  const u = new User()
  u.id = 1
  u.name = 'test'
  u.access = Access.Total
  return u
}
export function checkGrant(u, level) {
  return true
}