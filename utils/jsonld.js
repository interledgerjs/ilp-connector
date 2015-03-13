exports.setContext = function (ctx, contextFile) {
  ctx.set('Link', '</contexts/'+contextFile+'>; rel="http://www.w3.org/ns/json-ld#context"; type="application/ld+json"');
};
