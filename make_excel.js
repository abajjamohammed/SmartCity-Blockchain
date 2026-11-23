const XLSX = require("xlsx");

const issues = [
  {
    issueId: "CITY-2026-001",
    issueType: "StreetLight",
    location: "Avenue Mohammed V",
    description: "Streetlight not working near central roundabout",
    reportDate: "2026-11-19",
    priority: "High",
    reportedBy: "Citizen01",
    assignedTo: "UrbanTeam01",
    status: "Reported",
  },
  {
    issueId: "CITY-2026-002",
    issueType: "RoadDamage",
    location: "Boulevard Pasteur",
    description: "Deep pothole blocking right lane",
    reportDate: "2026-11-20",
    priority: "Critical",
    reportedBy: "Citizen02",
    assignedTo: "RoadTeam02",
    status: "Assigned",
  },
  {
    issueId: "CITY-2026-003",
    issueType: "Waste",
    location: "Quartier Administratif",
    description: "Overflowing public waste containers",
    reportDate: "2026-11-21",
    priority: "Medium",
    reportedBy: "Citizen03",
    assignedTo: "",
    status: "Reported",
  },
  {
    issueId: "CITY-2026-004",
    issueType: "WaterLeak",
    location: "Rue de Fes",
    description: "Water pipe leakage on sidewalk",
    reportDate: "2026-11-22",
    priority: "High",
    reportedBy: "Citizen04",
    assignedTo: "WaterTeam01",
    status: "InProgress",
  },
];

const ws = XLSX.utils.json_to_sheet(issues);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "UrbanIssues");
XLSX.writeFile(wb, "urban_issues.xlsx");

console.log("✅ Fichier 'urban_issues.xlsx' généré avec succès !");