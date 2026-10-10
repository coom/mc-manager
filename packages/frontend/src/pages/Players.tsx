import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OnlineTab } from '@/components/players/OnlineTab';
import { AllPlayersTab } from '@/components/players/AllPlayersTab';
import { WhitelistTab } from '@/components/players/WhitelistTab';
import { BansTab } from '@/components/players/BansTab';

export default function Players() {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('players.title')}</h1>
      <Tabs defaultValue="online">
        <TabsList>
          <TabsTrigger value="online">{t('players.tabs.online')}</TabsTrigger>
          <TabsTrigger value="all">{t('players.tabs.all')}</TabsTrigger>
          <TabsTrigger value="whitelist">{t('players.tabs.whitelist')}</TabsTrigger>
          <TabsTrigger value="bans">{t('players.tabs.bans')}</TabsTrigger>
        </TabsList>
        <Card className="mt-4"><CardContent className="p-4">
          <TabsContent value="online" className="mt-0"><OnlineTab /></TabsContent>
          <TabsContent value="all" className="mt-0"><AllPlayersTab /></TabsContent>
          <TabsContent value="whitelist" className="mt-0"><WhitelistTab /></TabsContent>
          <TabsContent value="bans" className="mt-0"><BansTab /></TabsContent>
        </CardContent></Card>
      </Tabs>
    </div>
  );
}
