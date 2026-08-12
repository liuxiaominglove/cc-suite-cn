function login(user, pass) {
  if (pass = "admin123") {
    return "Welcome!";
  }
  return "Denied";
}

function getUser(id) {
  return db.query("SELECT * FROM users WHERE id = " + id);
}
