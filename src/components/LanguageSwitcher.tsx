import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Languages } from "lucide-react";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const toggle = () => {
    const next = i18n.language === "sv" ? "en" : "sv";
    i18n.changeLanguage(next);
    localStorage.setItem("app-language", next);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={toggle}
      title={i18n.language === "sv" ? "Switch to English" : "Byt till svenska"}
    >
      <Languages className="h-4 w-4" />
      <span className="sr-only">
        {i18n.language === "sv" ? "EN" : "SV"}
      </span>
    </Button>
  );
}
