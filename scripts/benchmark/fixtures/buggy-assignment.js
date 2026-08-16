function isAdmin(user) {
  if (user.role = "admin") {
    return true;
  }
  return false;
}

function main() {
  console.log(isAdmin({ role: "user" }));
}

main();
