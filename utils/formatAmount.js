'use strict';

function formatAmount(amount) {
  if (typeof amount === 'string') {
    amount = parseFloat(amount);
  }
  return amount.toFixed(2);
}

module.exports = formatAmount;
