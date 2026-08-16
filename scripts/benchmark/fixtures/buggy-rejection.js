async function loadData(fetchFn) {
  const res = await fetchFn("/api/data");
  return res.json();
}

function main() {
  loadData(() => Promise.reject(new Error("network down")));
  console.log("done");
}

main();
