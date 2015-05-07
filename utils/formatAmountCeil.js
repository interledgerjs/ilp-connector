'use strict';

function formatAmountCeil(amount) {
  if (typeof amount === 'string') {
    amount = parseFloat(amount);
  }
  return (Math.ceil(amount * 100) / 100).toFixed(2);
}

module.exports = formatAmountCeil;
