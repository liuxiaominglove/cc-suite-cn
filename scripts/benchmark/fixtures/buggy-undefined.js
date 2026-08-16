function getName(user) {
  return user.profile.name;
}

function main() {
  const user = { id: 1 };
  console.log(getName(user));
}

main();
