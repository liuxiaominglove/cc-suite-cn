function getUserName(user) {
  if (!user || typeof user.name !== "string") {
    return "anonymous";
  }
  return user.name.toUpperCase();
}

function divide(a, b) {
  if (typeof b !== "number" || b === 0) {
    return null;
  }
  return a / b;
}

function main() {
  console.log(getUserName(null));
  console.log(divide(10, 0));
}

main();
