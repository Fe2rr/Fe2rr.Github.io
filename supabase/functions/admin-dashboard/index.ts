Deno.serve(() => new Response(JSON.stringify({
  success: false,
  error: "admin_moved_to_github",
}), {
  status: 410,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  },
}));
