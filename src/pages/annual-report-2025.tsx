import { useNavigate } from "react-router-dom";
import { AnnualReport2025 } from "../views/AnnualReport";

export default function AnnualReport2025Page() {
  const navigate = useNavigate();
  return <AnnualReport2025 onClose={() => navigate("/")} />;
}
