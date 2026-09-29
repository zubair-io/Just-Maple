import importlib.util
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('comparison',Path(__file__).with_name('compare-decision-models.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class ComparisonTests(unittest.TestCase):
    def test_missing_or_nonfinite_answers_are_failures(self):
        body={'questions':{'notify':{'type':'noul'}}}
        for answer in [{},{'type':'choice','noul':1},{'type':'noul','noul':float('nan')},{'type':'noul','noul':2}]:
            with self.assertRaises(ValueError):m.validate(body,{'model':'fixture','answers':{'notify':answer}})
    def test_choice_distribution_must_cover_every_option(self):
        body={'questions':{'kind':{'type':'choice','criteria':{'a':'A','b':'B'}}}}
        with self.assertRaises(ValueError):m.validate(body,{'model':'fixture','answers':{'kind':{'type':'choice','choice':'a','confidence':1,'probabilities':{'a':1}}}})
    def test_home_notification_uses_production_threshold(self):
        for probability,expected in [(.89,'retain'),(.9,'notify')]:
            result=m.judge({'answers':{'notify':{'noul':probability}}},{'route':expected},{})
            self.assertTrue(result['passed'])
    def test_task_review_is_not_the_same_as_reply_prompt(self):
        response={'answers':{'message_kind':{},'task_review_needed':{'noul':.6},'reply_needed':{'noul':.2}}}
        result=m.judge(response,{'review':'true','route':'retain'},{'state':{'event':{'type':'message.received'}}})
        self.assertTrue(result['passed'])
    def test_outgoing_message_cannot_prompt_for_a_reply(self):
        response={'answers':{'message_kind':{},'reply_needed':{'noul':1},'action_needed':{'noul':1}}}
        result=m.judge(response,{'route':'retain'},{'state':{'event':{'type':'message.sent'}}})
        self.assertTrue(result['passed'])

if __name__=='__main__':unittest.main()
