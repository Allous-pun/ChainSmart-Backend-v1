const generateOrgCode = (orgName, counter = 0) => {
  // Take first 3 letters of org name, uppercase, remove spaces
  let code = orgName
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 3)
    .toUpperCase();
  
  // Add random 4 digits
  const random = Math.floor(1000 + Math.random() * 9000);
  
  if (counter > 0) {
    return `${code}${random}${counter}`;
  }
  return `${code}${random}`;
};

module.exports = {
  generateOrgCode
};