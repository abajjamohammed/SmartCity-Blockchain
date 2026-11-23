export const LOCAL_CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
export const SEPOLIA_CONTRACT_ADDRESS = ""; // À remplir à l'étape 5 si déploiement Sepolia

export const CONTRACT_ABI = [
  // Rôles
  "function MUNICIPALITY_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",

  // Lectures
  "function totalIssues() view returns (uint256)",
  "function issueCodeExists(string issueId) view returns (bool)",
  "function codeToNumericId(string issueId) view returns (uint256)",
  "function getIssue(uint256 id) view returns (tuple(uint256 id, string issueId, string issueType, string location, string description, string reportDate, string priority, string reportedBy, string assignedTo, uint8 status, address reporterWallet, uint256 createdAt, uint256 updatedAt))",
  "function getIssueByCode(string issueId) view returns (tuple(uint256 id, string issueId, string issueType, string location, string description, string reportDate, string priority, string reportedBy, string assignedTo, uint8 status, address reporterWallet, uint256 createdAt, uint256 updatedAt))",
  "function getAllIssues() view returns (tuple(uint256 id, string issueId, string issueType, string location, string description, string reportDate, string priority, string reportedBy, string assignedTo, uint8 status, address reporterWallet, uint256 createdAt, uint256 updatedAt)[])",
  "function getIssueHistory(uint256 id) view returns (tuple(uint256 timestamp, uint8 status, string assignedTo, string comment, address updatedBy)[])",

  // Écritures
  "function reportIssue(string issueId, string issueType, string location, string description, string reportDate, string priority, string reportedBy) returns (uint256)",
  "function batchImportIssues(tuple(string issueId, string issueType, string location, string description, string reportDate, string priority, string reportedBy, string assignedTo, uint8 status)[] inputs)",
  "function assignTeam(uint256 id, string team, string comment)",
  "function updateIssueStatus(uint256 id, uint8 newStatus, string comment)",

  // Événements & Erreurs
  "event IssueReported(uint256 indexed id, string issueId, string issueType, string priority, address indexed reporterWallet)",
  "event TeamAssigned(uint256 indexed id, string assignedTo, address indexed updatedBy)",
  "event IssueStatusUpdated(uint256 indexed id, uint8 oldStatus, uint8 newStatus, string comment, address indexed updatedBy)",
  "event IssuesBatchImported(uint256 count, address indexed importedBy)",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)"
];