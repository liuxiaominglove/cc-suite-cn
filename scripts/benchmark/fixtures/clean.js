function add(a, b) {
  if (typeof a !== "number" || typeof b !== "number") {
    return 0;
  }
  return a + b;
}

function main() {
  console.log(add(1, 2));
}

main();
